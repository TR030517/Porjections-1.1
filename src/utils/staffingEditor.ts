import { buildStaffingPayload, readStaffingSnapshot, type StaffingSnapshot } from './shopStaffing';
function errorMessage(error: unknown, fallback: string): string {
  const e = error as { message?: unknown; response?: { data?: { message?: unknown; error?: { message?: unknown } } } } | null;
  const value = e?.response?.data?.message ?? e?.response?.data?.error?.message ?? e?.message;
  return typeof value === 'string' && value.trim() ? value : fallback;
}

interface Identity { actorId: string; shopId: string }
type Payload = ReturnType<typeof buildStaffingPayload>;
export interface StaffingEditorState {
  snapshot: StaffingSnapshot | null;
  target: number | null;
  loading: boolean;
  saving: boolean;
  verified: boolean;
  outcome: 'NONE' | 'SAVED' | 'UNKNOWN' | 'CONFLICT';
  reviewed: boolean;
  attempt: Payload | null;
  error: string;
}
interface Dependencies {
  identity: () => Identity | null;
  canWrite: () => boolean;
  read: (shopId: string, signal?: AbortSignal) => Promise<unknown>;
  write: (shopId: string, payload: Payload) => Promise<unknown>;
}
const empty = (): StaffingEditorState => ({ snapshot: null, target: null, loading: false, saving: false, verified: false, outcome: 'NONE', reviewed: false, attempt: null, error: '' });
const same = (a: Identity | null, b: Identity | null) => a === null ? b === null : b !== null && a.actorId === b.actorId && a.shopId === b.shopId;
const frozen = (state: StaffingEditorState) => state.outcome === 'UNKNOWN' || state.outcome === 'CONFLICT';
const rejected = (error: unknown) => {
  const value = error as { status?: unknown; response?: { status?: unknown } } | null;
  const status = value?.response?.status ?? value?.status;
  return typeof status === 'number' && [400, 401, 403, 404, 409, 429].includes(status);
};

/** A count change is one collection-CAS command. Read-back never retries it. */
export function createStaffingEditor(deps: Dependencies) {
  let state = empty(), owner: Identity | null = null, generation = 0, readVersion = 0, active = true;
  const listeners = new Set<() => void>();
  const publish = (next: StaffingEditorState) => {
    state = Object.freeze(next);
    for (const listener of [...listeners]) { try { listener(); } catch { /* Subscribers read the retained state on the next render. */ } }
  };
  const synchronize = () => {
    const next = deps.identity();
    if (!same(owner, next)) { generation++; readVersion++; owner = next && { ...next }; publish(empty()); }
  };
  const current = (version: number, actor: Identity) => {
    if (!active) return false;
    synchronize();
    return active && generation === version && same(owner, actor);
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    syncIdentity() {
      const previous = state, wasActive = active;
      active = true; synchronize();
      if (!wasActive && previous === state) publish(state);
    },
    changeTarget(target: number | null) {
      if (!active) return;
      synchronize();
      if (!owner || state.loading || state.saving || frozen(state) || !state.snapshot?.canManageStaff || !deps.canWrite()) return;
      publish({ ...state, target, outcome: 'NONE', attempt: null, error: '' });
    },
    async load(signal?: AbortSignal, preserveDraft = true): Promise<boolean> {
      if (!active) return false;
      synchronize();
      if (!owner || state.saving) return false;
      const actor = { ...owner }, version = generation, request = ++readVersion;
      const dirty = state.snapshot !== null && state.target !== state.snapshot.activeCount;
      publish({ ...state, loading: true, verified: false, reviewed: false });
      try {
        const value = readStaffingSnapshot(await deps.read(actor.shopId, signal), actor.shopId);
        if (!current(version, actor) || request !== readVersion || signal?.aborted) return false;
        const keep = frozen(state) || preserveDraft && dirty;
        publish({ ...state, snapshot: value, target: keep ? state.target : value.activeCount, loading: false, verified: true,
          reviewed: frozen(state), error: frozen(state) ? state.error : '' });
        return true;
      } catch (error) {
        if (current(version, actor) && request === readVersion && !signal?.aborted) {
          publish({ ...state, loading: false, verified: false, error: errorMessage(error, '无法读取本店人数，请重新读取后再保存。') });
        }
        return false;
      }
    },
    /** A sibling configuration save refreshes the collection CAS and labels,
     * while an existing draft/unknown result still belongs to its original
     * operator. This read is never an implicit acknowledgement or a retry. */
    async refresh(signal?: AbortSignal): Promise<boolean> {
      if (!active) return false;
      synchronize();
      if (!owner || state.saving || state.loading) return false;
      const actor = { ...owner }, version = generation, request = ++readVersion;
      const keepTarget = frozen(state) || state.snapshot !== null && state.target !== state.snapshot.activeCount;
      const reviewedRevision = state.reviewed ? state.snapshot?.revision : null;
      publish({ ...state, loading: true, verified: false });
      try {
        const value = readStaffingSnapshot(await deps.read(actor.shopId, signal), actor.shopId);
        if (!current(version, actor) || request !== readVersion || signal?.aborted) return false;
        publish({ ...state, snapshot: value, target: keepTarget ? state.target : value.activeCount, loading: false, verified: true,
          reviewed: frozen(state) && reviewedRevision === value.revision,
          error: frozen(state) ? state.error : '' });
        return true;
      } catch (error) {
        if (current(version, actor) && request === readVersion && !signal?.aborted) {
          publish({ ...state, loading: false, verified: false, error: frozen(state) ? state.error : errorMessage(error, '个人安排已保存，但人员人数尚未刷新。请重新读取后再保存人数。') });
        }
        return false;
      }
    },
    async save(): Promise<void> {
      if (!active) return;
      synchronize();
      if (!owner || !state.snapshot || !state.verified || state.loading || state.saving || frozen(state) || !state.snapshot.canManageStaff || !deps.canWrite()) return;
      const actor = { ...owner }, version = generation;
      let payload: Payload;
      try {
        const target = state.target;
        if (target === null) throw new Error('Missing count');
        payload = Object.freeze(buildStaffingPayload(target, state.snapshot.revision));
      }
      catch { publish({ ...state, error: '请填写0至100的整数。' }); return; }
      if (payload.targetActiveCount === state.snapshot.activeCount) return;
      publish({ ...state, saving: true, outcome: 'NONE', reviewed: false, attempt: payload, error: '' });
      if (!current(version, actor)) return;
      if (!deps.canWrite()) { publish({ ...state, saving: false, attempt: null, error: '当前权限尚未核对，请重新核对门店后再保存。' }); return; }
      let raw: unknown;
      try { raw = await deps.write(actor.shopId, payload); }
      catch (error) {
        if (!current(version, actor)) return;
        const code = (error as { response?: { data?: { code?: string; error?: { code?: string } } } } | null)?.response?.data;
        const conflict = code?.code === 'STAFFING_CHANGED' || code?.error?.code === 'STAFFING_CHANGED' || (error as { code?: unknown } | null)?.code === 'STAFFING_CHANGED';
        const known = rejected(error);
        publish({ ...state, saving: false, outcome: conflict ? 'CONFLICT' : known ? 'NONE' : 'UNKNOWN', reviewed: false,
          error: conflict ? '人员已被修改。目标人数已保留，请重新读取并核对后再保存。' : known
            ? errorMessage(error, '服务器已拒绝调整人数，未进行部分增减。')
            : '人数保存结果尚未确认，已阻止重复提交。请重新读取本店人员并核对。' });
        return;
      }
      if (!current(version, actor)) return;
      try {
        const value = readStaffingSnapshot(raw, actor.shopId);
        if (value.activeCount !== payload.targetActiveCount) throw new Error('人数回执不匹配。');
        publish({ ...state, snapshot: value, target: value.activeCount, saving: false, verified: true, outcome: 'SAVED', attempt: null, error: '' });
      } catch {
        publish({ ...state, saving: false, verified: false, outcome: 'UNKNOWN', reviewed: false,
          error: '无法核对保存回执，已阻止重复提交。请重新读取本店人员并核对。' });
      }
    },
    acknowledgeReview(): boolean {
      if (!active) return false;
      synchronize();
      if (!owner || !frozen(state) || !state.reviewed || !state.verified || state.loading || state.saving) return false;
      publish({ ...state, outcome: 'NONE', attempt: null, reviewed: false, error: '' });
      return true;
    },
    // React owns each subscription. Keep it through an actor/shop effect reset;
    // unmount unsubscribes normally and inactive requests cannot publish.
    dispose() { active = false; generation++; readVersion++; owner = null; state = empty(); },
  };
}
