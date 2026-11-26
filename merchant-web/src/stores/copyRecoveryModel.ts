import type { CopyInput, CopyPreview, CopyResult, CopyResolution } from '../api/accountAccess';

export interface RecoverableCopy {
  actorId: string; input: CopyInput; preview: CopyPreview; idempotencyKey: string;
  state: 'IN_FLIGHT' | 'CHECKING' | 'UNKNOWN' | 'REJECTED' | 'NOT_APPLIED' | 'APPLIED';
  attempts: number; error: string; result: CopyResult | null; restored?: boolean;
}
export interface CopyRecoverySnapshot { actorId: string | null; operation: RecoverableCopy | null; storageWarning: string }
export interface CopyRecoveryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface CopyRecoverySession {
  initialized: boolean; authenticated: boolean; actor: { id: string; role?: string } | null;
  /** Explicit logout differs from a temporarily unavailable automatic refresh. */
  explicitLogout?: boolean;
}
export interface CopyRecoveryValidators {
  input(value: unknown): CopyInput;
  request(previewHash: unknown, idempotencyKey: unknown): { previewHash: string; idempotencyKey: string };
  preview(value: unknown, input: CopyInput): CopyPreview;
  result(value: unknown, input: CopyInput): CopyResult;
  resolution(value: unknown, input: CopyInput, idempotencyKey: string): CopyResolution;
}
export interface CopyRecoveryDependencies {
  storage: () => CopyRecoveryStorage | null;
  apply(input: CopyInput, previewHash: string, idempotencyKey: string): Promise<CopyResult>;
  resolve(input: CopyInput, previewHash: string, idempotencyKey: string): Promise<CopyResolution>;
  validators: CopyRecoveryValidators;
  randomKey?: () => string;
  now?: () => number;
}
export interface CopyRecoveryModel {
  getSnapshot(): CopyRecoverySnapshot;
  subscribe(listener: () => void): () => void;
  syncSession(session: CopyRecoverySession): void;
  begin(input: CopyInput, preview: CopyPreview): Promise<void>;
  retry(): Promise<void>;
  check(): Promise<void>;
  finish(): void;
}
export const COPY_RECOVERY_STORAGE_KEY = 'massajoy.copy.pending.v1';
interface PendingMarker { v: 1; actorId: string; input: CopyInput; key: string; previewHash: string; expiresAt: string }
const STORAGE_WARNING = '无法安全保存或清除待核对标识，请允许当前标签页使用会话存储后重试。未保存标识时不会提交复制。';
const UNKNOWN_MESSAGE = '原复制结果仍未知，请查询结果，或使用完全相同的原请求重试。';
const terminal = (state: RecoverableCopy['state']) => ['APPLIED', 'REJECTED', 'NOT_APPLIED'].includes(state);
function id(value: unknown): value is string { return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n; }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

/** Framework-free recovery core. Only a signed request marker survives a refresh. */
export function createCopyRecoveryModel(deps: CopyRecoveryDependencies): CopyRecoveryModel {
  const validators = deps.validators, now = deps.now ?? Date.now;
  const randomKey = deps.randomKey ?? (() => globalThis.crypto.randomUUID());
  let snapshot: CopyRecoverySnapshot = freeze({ actorId: null, operation: null, storageWarning: '' });
  let generation = 0;
  const listeners = new Set<() => void>();
  function publish(next: CopyRecoverySnapshot) { snapshot = freeze(next); listeners.forEach(listener => listener()); }
  function warn() { publish({ ...snapshot, storageWarning: STORAGE_WARNING }); }
  function marker(operation: RecoverableCopy): PendingMarker {
    return { v: 1, actorId: operation.actorId, input: operation.input, key: operation.idempotencyKey, previewHash: operation.preview.previewHash, expiresAt: operation.preview.expiresAt };
  }
  function parse(raw: string): PendingMarker {
    if (raw.length > 4096) throw new Error('Invalid marker');
    const data = JSON.parse(raw) as PendingMarker;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1 || !id(data.actorId) || Object.keys(data).some(key => !['v', 'actorId', 'input', 'key', 'previewHash', 'expiresAt'].includes(key))) throw new Error('Invalid marker');
    const input = validators.input(data.input);
    if (Object.keys(data.input).some(key => !['sourceShopId', 'targetShopId', 'kind'].includes(key))) throw new Error('Invalid marker');
    const request = validators.request(data.previewHash, data.key);
    if (typeof data.expiresAt !== 'string' || data.expiresAt.length > 64 || !Number.isFinite(Date.parse(data.expiresAt))) throw new Error('Invalid marker');
    return { v: 1, actorId: data.actorId, input, key: request.idempotencyKey, previewHash: request.previewHash, expiresAt: data.expiresAt };
  }
  function clearMarker(expected?: RecoverableCopy, quiet = false): boolean {
    try {
      const storage = deps.storage();
      if (!storage) throw new Error('Storage unavailable');
      const existing = storage.getItem(COPY_RECOVERY_STORAGE_KEY);
      if (expected && existing !== null && JSON.stringify(parse(existing)) !== JSON.stringify(marker(expected))) throw new Error('Different pending marker');
      storage.removeItem(COPY_RECOVERY_STORAGE_KEY);
      if (storage.getItem(COPY_RECOVERY_STORAGE_KEY) !== null) throw new Error('Marker retained');
      return true;
    } catch { if (!quiet) warn(); return false; }
  }
  function persist(operation: RecoverableCopy, reuse: boolean): boolean {
    try {
      const storage = deps.storage();
      if (!storage) throw new Error('Storage unavailable');
      const raw = JSON.stringify(marker(operation)), existing = storage.getItem(COPY_RECOVERY_STORAGE_KEY);
      if (existing !== null && (!reuse || JSON.stringify(parse(existing)) !== raw)) throw new Error('Different pending marker');
      storage.setItem(COPY_RECOVERY_STORAGE_KEY, raw);
      if (storage.getItem(COPY_RECOVERY_STORAGE_KEY) !== raw) throw new Error('Marker not persisted');
      return true;
    } catch { warn(); return false; }
  }
  function restore(actorId: string): { operation: RecoverableCopy | null; storageWarning: string } {
    let raw: string | null;
    try { const storage = deps.storage(); if (!storage) throw new Error('Storage unavailable'); raw = storage.getItem(COPY_RECOVERY_STORAGE_KEY); }
    catch { return { operation: null, storageWarning: STORAGE_WARNING }; }
    if (raw === null) return { operation: null, storageWarning: '' };
    try {
      const saved = parse(raw);
      if (saved.actorId !== actorId) return { operation: null, storageWarning: clearMarker(undefined, true) ? '' : STORAGE_WARNING };
      const operation: RecoverableCopy = { actorId, input: saved.input, idempotencyKey: saved.key,
        preview: { previewHash: saved.previewHash, expiresAt: saved.expiresAt, summary: '已恢复签名请求，预览明细未保存；请先查询原操作结果。', changes: {} },
        state: 'UNKNOWN', attempts: 0, error: UNKNOWN_MESSAGE, result: null, restored: true };
      return { operation, storageWarning: '' };
    } catch { clearMarker(undefined, true); return { operation: null, storageWarning: '无法读取已保存的核对标识。开始新复制前，请核对本人近期复制记录与目标配置。' }; }
  }
  function current(version: number, operation: RecoverableCopy) {
    return generation === version && snapshot.actorId === operation.actorId && snapshot.operation?.idempotencyKey === operation.idempotencyKey;
  }
  async function execute(previous: RecoverableCopy, checkOnly: boolean, previouslyUnknown: boolean) {
    const version = generation;
    const operation: RecoverableCopy = { ...previous, state: checkOnly ? 'CHECKING' : 'IN_FLIGHT', attempts: previous.attempts + (checkOnly ? 0 : 1), error: '' };
    publish({ ...snapshot, operation, storageWarning: checkOnly ? snapshot.storageWarning : '' });
    if (!current(version, operation)) return;
    try {
      const raw = checkOnly ? await deps.resolve(operation.input, operation.preview.previewHash, operation.idempotencyKey) : await deps.apply(operation.input, operation.preview.previewHash, operation.idempotencyKey);
      if (!current(version, operation)) return;
      const result = checkOnly ? validators.resolution(raw, operation.input, operation.idempotencyKey) : validators.result(raw, operation.input);
      const next: RecoverableCopy = result.status === 'APPLIED'
        ? { ...operation, state: 'APPLIED', error: '', result }
        : { ...operation, state: result.status, error: result.status === 'UNKNOWN' ? UNKNOWN_MESSAGE : '服务器已确认原请求未执行，可结束后重新预览。', result: null };
      // Cleanup precedes terminal notifications: observers may synchronously start the next request.
      if (terminal(next.state)) clearMarker(operation);
      if (current(version, operation)) publish({ ...snapshot, operation: next });
    } catch (error) {
      if (!current(version, operation)) return;
      const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
      const unknown = checkOnly || previouslyUnknown || typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status === 408 || status >= 500;
      const next: RecoverableCopy = { ...operation, state: unknown ? 'UNKNOWN' : 'REJECTED', error: unknown ? UNKNOWN_MESSAGE : '服务器已拒绝首次请求；请结束后重新核对配置并生成预览。', result: null };
      if (!unknown) clearMarker(operation);
      if (current(version, operation)) publish({ ...snapshot, operation: next });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    syncSession(session) {
      if (!session.initialized) return;
      const allowed = session.authenticated && session.actor && id(session.actor.id) && ['ADMIN', 'MERCHANT'].includes(session.actor.role ?? '');
      const actorId = allowed ? session.actor!.id : null;
      if (actorId !== null && actorId === snapshot.actorId) return;
      const previousActor = snapshot.actorId;
      const preserveOpaque = !session.explicitLogout && !session.actor && !session.authenticated;
      if (preserveOpaque && previousActor === null) return;
      const version = ++generation;
      // Clear before publishing a different session so a listener's new operation cannot be erased.
      const recovered = preserveOpaque
        ? { operation: null, storageWarning: '' }
        : actorId !== null && previousActor === null
          ? restore(actorId)
          : { operation: null, storageWarning: clearMarker(undefined, true) ? '' : STORAGE_WARNING };
      if (generation === version) publish({ actorId, ...recovered });
    },
    async begin(input, preview) {
      if (!snapshot.actorId) throw new Error('请先使用公司管理员或商家账号登录，再复制设置。');
      if (snapshot.operation) throw new Error('开始新复制前，请完成或核对现有操作。');
      const safeInput = validators.input(input), safePreview = validators.preview(preview, safeInput);
      if (Date.parse(safePreview.expiresAt) <= now()) throw new Error('复制预览已过期，请重新生成并核对。');
      const request = validators.request(safePreview.previewHash, randomKey());
      const operation: RecoverableCopy = { actorId: snapshot.actorId, input: safeInput, preview: safePreview, idempotencyKey: request.idempotencyKey, state: 'IN_FLIGHT', attempts: 0, error: '', result: null };
      if (!persist(operation, false)) throw new Error(STORAGE_WARNING);
      await execute(operation, false, false);
    },
    async retry() {
      const operation = snapshot.operation;
      if (!operation || operation.actorId !== snapshot.actorId || operation.state !== 'UNKNOWN') throw new Error('暂无可重试的未核实复制。');
      if (!persist(operation, true)) throw new Error(STORAGE_WARNING);
      await execute(operation, false, true);
    },
    async check() {
      const operation = snapshot.operation;
      if (!operation || operation.actorId !== snapshot.actorId || operation.state !== 'UNKNOWN') throw new Error('暂无可查询的未核实复制。');
      await execute(operation, true, true);
    },
    finish() {
      const operation = snapshot.operation;
      if (!snapshot.actorId) throw new Error('请先使用已授权账号登录，再复制设置。');
      if (!operation || operation.actorId !== snapshot.actorId) return;
      if (!terminal(operation.state)) throw new Error('结果仍未知，请查询原操作，不可将其作为失败复制直接放弃。');
      const version = generation;
      if (!clearMarker(operation)) throw new Error(STORAGE_WARNING);
      if (current(version, operation)) publish({ ...snapshot, operation: null, storageWarning: '' });
    },
  };
}
