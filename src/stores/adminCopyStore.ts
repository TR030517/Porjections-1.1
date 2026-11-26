import type { SessionUser } from '../api/session';
import {
  applyCopy, resolveCopy, checkedCopyId, checkedCopyInput, checkedCopyPreview,
  checkedCopyRequest, checkedCopyResult, checkedCopyResolution,
  type CopyInput, type CopyPreview, type CopyResult, type CopyResolution,
} from '../api/storeCopy';

export type AdminCopyState = 'IN_FLIGHT' | 'CHECKING' | 'UNKNOWN' | 'APPLIED' | 'REJECTED' | 'NOT_APPLIED';
export interface AdminCopyOperation {
  actorId: string; input: CopyInput; preview: CopyPreview; idempotencyKey: string;
  state: AdminCopyState; attempts: number; error: string; result: CopyResult | null; restored?: boolean;
}
export interface AdminCopySnapshot { actorId: string | null; operation: AdminCopyOperation | null; storageWarning: string }
export interface AdminCopyStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface AdminCopyDependencies {
  storage?: () => AdminCopyStorage | null;
  apply?: (input: CopyInput, previewHash: string, idempotencyKey: string) => Promise<CopyResult>;
  resolve?: (input: CopyInput, previewHash: string, idempotencyKey: string) => Promise<CopyResolution>;
  randomKey?: () => string;
  now?: () => number;
}
export interface AdminCopyStore {
  getAdminCopySnapshot(): AdminCopySnapshot;
  subscribeAdminCopy(listener: () => void): () => void;
  syncAdminCopySession(user: SessionUser | null): void;
  startAdminCopy(input: CopyInput, preview: CopyPreview): Promise<void>;
  retryAdminCopy(): Promise<void>;
  checkAdminCopy(): Promise<void>;
  finishAdminCopy(): void;
}
export const ADMIN_COPY_STORAGE_KEY = 'massajoy.admin-copy.pending.v1';
interface PendingMarker { v: 1; actorId: string; input: CopyInput; key: string; previewHash: string; expiresAt: string }
const STORAGE_WARNING = '无法安全保存或清除待核对记录，请允许当前标签页使用会话存储后重试。';
const UNKNOWN_MESSAGE = '复制结果尚未确认，请保留本次请求并查询结果；重试只会使用原请求标识。';
const TERMINAL = new Set<AdminCopyState>(['APPLIED', 'REJECTED', 'NOT_APPLIED']);

function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) immutable(item);
    Object.freeze(value);
  }
  return value;
}
function actor(user: SessionUser | null): string | null {
  if (!user || user.role !== 'ADMIN') return null;
  try {
    if (typeof user.id !== 'string' && typeof user.id !== 'number') return null;
    if (typeof user.id === 'number' && (!Number.isSafeInteger(user.id) || user.id <= 0)) return null;
    return checkedCopyId(String(user.id));
  } catch { return null; }
}
function pending(operation: AdminCopyOperation): PendingMarker {
  return { v: 1, actorId: operation.actorId, input: operation.input, key: operation.idempotencyKey, previewHash: operation.preview.previewHash, expiresAt: operation.preview.expiresAt };
}
function parseMarker(raw: string): PendingMarker {
  if (raw.length > 4096) throw new Error('Invalid marker');
  const data = JSON.parse(raw) as PendingMarker;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['v', 'actorId', 'input', 'key', 'previewHash', 'expiresAt'].includes(key)) || data.v !== 1) throw new Error('Invalid marker');
  const actorId = checkedCopyId(data.actorId), input = checkedCopyInput(data.input);
  if (Object.keys(data.input).some(key => !['sourceShopId', 'targetShopId', 'kind'].includes(key))) throw new Error('Invalid marker');
  const request = checkedCopyRequest(data.previewHash, data.key);
  if (typeof data.expiresAt !== 'string' || data.expiresAt.length > 64 || !Number.isFinite(Date.parse(data.expiresAt))) throw new Error('Invalid marker');
  return { v: 1, actorId, input, key: request.idempotencyKey, previewHash: request.previewHash, expiresAt: data.expiresAt };
}

/** One store per tab, independent of modal mounts. Dependencies permit deterministic recovery tests. */
export function createAdminCopyStore(deps: AdminCopyDependencies = {}): AdminCopyStore {
  const getStorage = deps.storage ?? (() => typeof window === 'undefined' ? null : window.sessionStorage);
  const send = deps.apply ?? applyCopy, resolve = deps.resolve ?? resolveCopy;
  const randomKey = deps.randomKey ?? (() => `admin-copy:${globalThis.crypto.randomUUID()}`);
  const now = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: AdminCopySnapshot = immutable({ actorId: null, operation: null, storageWarning: '' });
  let generation = 0;
  function publish(next: AdminCopySnapshot) {
    snapshot = immutable(next);
    listeners.forEach(listener => listener());
  }
  function warning() { publish({ ...snapshot, storageWarning: STORAGE_WARNING }); }
  function removeMarker(): boolean {
    try {
      const storage = getStorage();
      if (!storage) throw new Error('Unavailable storage');
      storage.removeItem(ADMIN_COPY_STORAGE_KEY);
      if (storage.getItem(ADMIN_COPY_STORAGE_KEY) !== null) throw new Error('Marker not removed');
      return true;
    } catch { warning(); return false; }
  }
  function saveMarker(operation: AdminCopyOperation, reuse = false): boolean {
    try {
      const storage = getStorage();
      if (!storage) throw new Error('Storage unavailable');
      const raw = JSON.stringify(pending(operation));
      const existing = storage.getItem(ADMIN_COPY_STORAGE_KEY);
      if (existing !== null && (!reuse || JSON.stringify(parseMarker(existing)) !== raw)) throw new Error('Different pending marker exists');
      storage.setItem(ADMIN_COPY_STORAGE_KEY, raw);
      if (storage.getItem(ADMIN_COPY_STORAGE_KEY) !== raw) throw new Error('Marker not persisted');
      return true;
    } catch { warning(); return false; }
  }
  function restore(actorId: string): AdminCopyOperation | null {
    let raw: string | null;
    try {
      const storage = getStorage();
      if (!storage) throw new Error('Unavailable storage');
      raw = storage.getItem(ADMIN_COPY_STORAGE_KEY);
    } catch { warning(); return null; }
    if (raw === null) return null;
    try {
      const saved = parseMarker(raw);
      if (saved.actorId !== actorId) { removeMarker(); return null; }
      return {
        actorId, input: saved.input, idempotencyKey: saved.key,
        preview: { previewHash: saved.previewHash, expiresAt: saved.expiresAt, summary: '已恢复原签名请求；预览明细未保存，请先查询结果。', changes: {} },
        state: 'UNKNOWN', attempts: 0, error: UNKNOWN_MESSAGE, result: null, restored: true,
      };
    } catch { removeMarker(); warning(); return null; }
  }
  function current(version: number, operation: AdminCopyOperation): boolean {
    return generation === version && snapshot.actorId === operation.actorId && snapshot.operation?.idempotencyKey === operation.idempotencyKey;
  }
  async function execute(operation: AdminCopyOperation, checkOnly: boolean, wasUnknown: boolean): Promise<void> {
    const version = generation;
    const active: AdminCopyOperation = { ...operation, state: checkOnly ? 'CHECKING' : 'IN_FLIGHT', attempts: operation.attempts + (checkOnly ? 0 : 1), error: '' };
    publish({ ...snapshot, operation: active, storageWarning: checkOnly ? snapshot.storageWarning : '' });
    if (!current(version, active)) return;
    try {
      const raw = checkOnly
        ? await resolve(active.input, active.preview.previewHash, active.idempotencyKey)
        : await send(active.input, active.preview.previewHash, active.idempotencyKey);
      if (!current(version, active)) return;
      const result = checkOnly ? checkedCopyResolution(raw, active.input, active.idempotencyKey) : checkedCopyResult(raw, active.input);
      const next: AdminCopyOperation = result.status === 'APPLIED'
        ? { ...active, state: 'APPLIED', error: '', result }
        : { ...active, state: result.status, error: result.status === 'UNKNOWN' ? UNKNOWN_MESSAGE : '已核对：原请求未执行，可结束后重新预览。', result: null };
      // Remove the old marker before observers can finish and start another operation.
      if (TERMINAL.has(next.state)) removeMarker();
      if (current(version, active)) publish({ ...snapshot, operation: next });
    } catch (error) {
      if (!current(version, active)) return;
      const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status : undefined;
      // A retry's denial cannot disprove an earlier commit whose response was lost.
      const uncertain = checkOnly || wasUnknown || typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status === 408 || status >= 500;
      const next: AdminCopyOperation = { ...active, state: uncertain ? 'UNKNOWN' : 'REJECTED', error: uncertain ? UNKNOWN_MESSAGE : '服务器已拒绝此次首次请求，可结束后重新生成预览。', result: null };
      if (!uncertain) removeMarker();
      if (current(version, active)) publish({ ...snapshot, operation: next });
    }
  }
  return {
    getAdminCopySnapshot: () => snapshot,
    subscribeAdminCopy(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    syncAdminCopySession(user) {
      const actorId = actor(user);
      if (actorId !== null && actorId === snapshot.actorId) return;
      const previousActor = snapshot.actorId;
      // Initial profile restoration can temporarily fail without identifying an actor.
      // Preserve the opaque marker until a verified identity arrives; never restore it here.
      if (user === null && previousActor === null) return;
      generation++;
      publish({ actorId, operation: null, storageWarning: '' });
      if (actorId === null || previousActor !== null) { removeMarker(); return; }
      const operation = restore(actorId);
      publish({ ...snapshot, operation });
    },
    async startAdminCopy(input, preview) {
      if (!snapshot.actorId) throw new Error('请使用公司管理员账号登录后复制。');
      if (snapshot.operation) throw new Error('请先核对并结束上一笔复制操作。');
      const safeInput = checkedCopyInput(input), safePreview = checkedCopyPreview(preview, safeInput);
      if (Date.parse(safePreview.expiresAt) <= now()) throw new Error('复制预览已过期，请重新生成预览。');
      const idempotencyKey = checkedCopyRequest(safePreview.previewHash, randomKey()).idempotencyKey;
      const operation: AdminCopyOperation = { actorId: snapshot.actorId, input: safeInput, preview: safePreview, idempotencyKey, state: 'IN_FLIGHT', attempts: 0, error: '', result: null };
      // This synchronous lock and durable marker precede the first await/transport.
      if (!saveMarker(operation)) throw new Error(STORAGE_WARNING);
      await execute(operation, false, false);
    },
    async retryAdminCopy() {
      const operation = snapshot.operation;
      if (!operation || operation.state !== 'UNKNOWN' || operation.actorId !== snapshot.actorId) throw new Error('仅可重试当前待核对的原请求。');
      if (!saveMarker(operation, true)) throw new Error(STORAGE_WARNING);
      await execute(operation, false, true);
    },
    async checkAdminCopy() {
      const operation = snapshot.operation;
      if (!operation || operation.state !== 'UNKNOWN' || operation.actorId !== snapshot.actorId) throw new Error('仅可查询当前待核对的原请求。');
      await execute(operation, true, true);
    },
    finishAdminCopy() {
      if (!snapshot.operation || !TERMINAL.has(snapshot.operation.state)) throw new Error('操作结果尚未确认，不能清除原请求。');
      if (!removeMarker()) throw new Error(STORAGE_WARNING);
      publish({ ...snapshot, operation: null, storageWarning: '' });
    },
  };
}

const adminCopyStore = createAdminCopyStore();
export const getAdminCopySnapshot = adminCopyStore.getAdminCopySnapshot;
export const subscribeAdminCopy = adminCopyStore.subscribeAdminCopy;
export const syncAdminCopySession = adminCopyStore.syncAdminCopySession;
export const startAdminCopy = adminCopyStore.startAdminCopy;
export const retryAdminCopy = adminCopyStore.retryAdminCopy;
export const checkAdminCopy = adminCopyStore.checkAdminCopy;
export const finishAdminCopy = adminCopyStore.finishAdminCopy;
