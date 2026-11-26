export interface TechnicianRow { id: string; shopId: string; name: string; bio: string | null; status: 'ACTIVE' | 'INACTIVE'; serviceIds: string[] }
export interface StoreIdentity { actorId: string; shopId: string }
export interface TechnicianDraft { name: string; bio: string; status: 'ACTIVE' | 'INACTIVE'; }
export interface TechnicianPayload extends TechnicianDraft { shopId?: string }
export type TechnicianCreateState = 'IDLE' | 'IN_FLIGHT' | 'UNKNOWN' | 'APPLIED' | 'REJECTED';
export interface TechnicianCreateSnapshot { state: TechnicianCreateState; payload: TechnicianPayload | null; result: TechnicianRow | null; error: string }
export interface TechnicianCreateDependencies { currentIdentity: () => StoreIdentity | null; create: (shopId: string, payload: TechnicianPayload) => Promise<unknown>; verify: (value: unknown, shopId: string, payload: TechnicianPayload) => void }
const fail = (message = '无法核对本店技师资料，请刷新。'): never => { throw new Error(message); };
export function scopedId(value: unknown): string | null {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value : '';
  return /^[1-9]\d{0,18}$/u.test(id) && BigInt(id) <= 9223372036854775807n ? id : null;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(); }
function requireId(value: unknown) { return scopedId(value) ?? fail('请先明确选择有效门店或资源。'); }
function status(value: unknown): TechnicianDraft['status'] { return value === 'ACTIVE' || value === 'INACTIVE' ? value : fail('请选择有效的技师启停状态。'); }
function name(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(value)) fail('技师名称须为非空纯文本，最多100字。');
  return (value as string).trim();
}
function services(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail('历史项目关联格式无法核对。');
  const ids = value.map(requireId); if (new Set(ids).size !== ids.length) fail('历史项目关联编号不能重复。'); return ids;
}
export function technicianRow(value: unknown, shopId: unknown): TechnicianRow {
  const row = record(value), shop = requireId(shopId); if (requireId(row.shopId) !== shop) fail('技师不属于当前门店，请重新加载。');
  if (row.bio !== null && typeof row.bio !== 'string') fail('技师简介格式无效。');
  return { id: requireId(row.id), shopId: shop, name: name(row.name), bio: row.bio as string | null, status: status(row.status), serviceIds: services(row.serviceIds) };
}
export function technicianPayload(draft: TechnicianDraft, shopId: unknown, creating: boolean): TechnicianPayload {
  const shop = requireId(shopId), value = record(draft); if (typeof value.bio !== 'string' || value.bio.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.bio)) fail('技师简介最多5000字，请手动精简，不会自动截断。');
  return { ...(creating ? { shopId: shop } : {}), name: name(value.name), bio: (value.bio as string).trim(), status: status(value.status) };
}
export function verifyTechnicianReceipt(value: unknown, shopId: unknown, payload: TechnicianPayload, expectedId?: unknown): TechnicianRow {
  const row = technicianRow(value, shopId), expected = technicianPayload(payload, shopId, false);
  if (expectedId !== undefined && row.id !== requireId(expectedId) || payload.shopId !== undefined && requireId(payload.shopId) !== row.shopId || row.name !== expected.name || (row.bio ?? '').trim() !== expected.bio || row.status !== expected.status) fail('无法核对技师保存回执，请保留草稿并只读刷新，勿重复新增。');
  return row;
}
const same = (a: StoreIdentity | null, b: StoreIdentity | null) => a === null ? b === null : b !== null && a.actorId === b.actorId && a.shopId === b.shopId;
function identity(read: () => StoreIdentity | null): StoreIdentity | null { try { const value = read(), actorId = scopedId(value?.actorId), shopId = scopedId(value?.shopId); return actorId && shopId ? { actorId, shopId } : null; } catch { return null; } }
export function createTechnicianContextGuard(readIdentity: () => StoreIdentity | null) {
  let owner: StoreIdentity | null = null, generation = 0, active = true;
  const synchronize = () => { const next = identity(readIdentity); if (!same(owner, next)) { owner = next; generation++; } return owner; };
  return {
    sync() { active = true; const value = synchronize(); return value ? { ...value } : null; },
    capture() { if (!active) return null; const actor = synchronize(), version = generation; if (!actor) return null; let finished = false; return { current: () => { if (!active || finished) return false; synchronize(); return generation === version && same(owner, actor); }, finish: () => { finished = true; } }; },
    invalidate() { generation++; },
    dispose() { active = false; owner = null; generation++; },
  };
}
/** Final synchronous dispatch check, including a parent switch before React cleanup. */
export function dispatchTechnicianEdit<T>(ticket: { current: () => boolean } | null, row: Pick<TechnicianRow, 'shopId'>, shopId: unknown, version: number, currentVersion: () => number, sameContext: () => boolean, mutate: () => Promise<T>): Promise<T | null> {
  if (!ticket?.current() || !sameContext() || scopedId(row.shopId) !== scopedId(shopId) || version !== currentVersion()) return Promise.resolve(null);
  return mutate();
}
function immutable<T>(value: T): T { const result = structuredClone(value), seen = new WeakSet<object>(); const freeze = (item: unknown) => { if (!item || typeof item !== 'object' || seen.has(item)) return; seen.add(item); Object.values(item).forEach(freeze); Object.freeze(item); }; freeze(result); return result; }
const empty = (): TechnicianCreateSnapshot => Object.freeze({ state: 'IDLE', payload: null, result: null, error: '' });
export function createTechnicianCreateFence(deps: TechnicianCreateDependencies) {
  let owner: StoreIdentity | null = null, generation = 0, active = true, snapshot = empty(); const listeners = new Set<() => void>();
  const publish = (value: TechnicianCreateSnapshot) => { snapshot = Object.freeze(value); for (const listener of [...listeners]) try { listener(); } catch { /* Stable snapshot remains readable. */ } };
  const sync = () => { const next = identity(deps.currentIdentity); if (!same(owner, next)) { owner = next; generation++; publish(empty()); } };
  const current = (version: number, actor: StoreIdentity) => { if (!active) return false; sync(); return generation === version && same(owner, actor); };
  const finish = (acknowledgeUnknown = false) => { if (!active) return false; sync(); if (!['APPLIED', 'REJECTED'].includes(snapshot.state) && !(snapshot.state === 'UNKNOWN' && acknowledgeUnknown === true)) return false; generation++; publish(empty()); return true; };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    syncIdentity() { active = true; sync(); },
    async submit(payload: TechnicianPayload): Promise<void> {
      if (!active) return; sync(); if (!owner || !['IDLE', 'REJECTED'].includes(snapshot.state)) return; const actor = { ...owner }, version = generation; let submitted: TechnicianPayload;
      try { if (scopedId(payload.shopId) !== actor.shopId) fail('新增技师必须固定在当前门店。'); submitted = immutable(technicianPayload(payload, actor.shopId, true)); } catch { publish({ state: 'REJECTED', payload: null, result: null, error: '请核对当前门店与技师草稿。' }); return; }
      publish({ state: 'IN_FLIGHT', payload: submitted, result: null, error: '' }); if (!current(version, actor) || snapshot.state !== 'IN_FLIGHT') return;
      let value: unknown;
      try { value = await deps.create(actor.shopId, submitted); } catch (error) { if (!current(version, actor)) return; const failure = error as { status?: unknown; response?: { status?: unknown } } | null, code = failure?.response?.status === undefined ? failure?.status : failure.response.status, rejected = typeof code === 'number' && [400, 401, 403, 404, 429].includes(code); publish({ state: rejected ? 'REJECTED' : 'UNKNOWN', payload: submitted, result: null, error: rejected ? '服务器已拒绝本次新增，请核对草稿。' : '新增结果未知，已阻止重复提交；请只读核对原结果。' }); return; }
      if (!current(version, actor)) return;
      try { deps.verify(value, actor.shopId, submitted); const result = immutable(technicianRow(value, actor.shopId)); if (current(version, actor)) publish({ state: 'APPLIED', payload: submitted, result, error: '' }); } catch { if (current(version, actor)) publish({ state: 'UNKNOWN', payload: submitted, result: null, error: '无法核对新增回执，结果未知；请只读核对，勿重复新增。' }); }
    },
    finish,
    finishUnknown(acknowledged: boolean) { return snapshot.state === 'UNKNOWN' && acknowledged === true ? finish(true) : false; },
    dispose() { active = false; generation++; owner = null; snapshot = empty(); listeners.clear(); },
  };
}
