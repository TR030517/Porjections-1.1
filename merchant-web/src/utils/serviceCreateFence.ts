import type { CreateServiceDto, ServiceItem } from '../api/merchant';

export type ServiceCreateFenceState = 'IDLE' | 'IN_FLIGHT' | 'UNKNOWN' | 'APPLIED' | 'REJECTED';
export interface ServiceCreateFenceSnapshot {
  state: ServiceCreateFenceState;
  payload: CreateServiceDto | null;
  result: ServiceItem | null;
  error: string;
}
export interface ServiceCreateFenceDependencies {
  currentIdentity: () => { actorId: string; shopId: string } | null;
  create: (shopId: string, payload: CreateServiceDto) => Promise<ServiceItem>;
  verify: (value: ServiceItem, shopId: string, payload: CreateServiceDto) => void;
}
type Identity = { actorId: string; shopId: string };
const unknownMessage = '新建结果尚未确认，已阻止重复提交。请核对原请求结果后再明确结束本次操作。';
const empty = (): ServiceCreateFenceSnapshot => Object.freeze({ state: 'IDLE', payload: null, result: null, error: '' });
const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/u.test(value) && BigInt(value) <= 9223372036854775807n;
const sameIdentity = (a: Identity | null, b: Identity | null) => a === null ? b === null : b !== null && a.actorId === b.actorId && a.shopId === b.shopId;

function immutableClone<T>(value: T): T {
  const copy = structuredClone(value), seen = new WeakSet<object>();
  const freeze = (item: unknown) => {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    for (const part of Object.values(item)) freeze(part);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}
function rejectedStatus(error: unknown): number | null {
  const response = error && typeof error === 'object' ? (error as { response?: unknown }).response : null;
  const status = response && typeof response === 'object' ? (response as { status?: unknown }).status : undefined;
  return typeof status === 'number' && [400, 401, 403, 404, 429].includes(status) ? status : null;
}

/** One explicit creation attempt. No retry, list lookup, permission cache or cancellation side effect. */
export function createServiceCreateFence(deps: ServiceCreateFenceDependencies) {
  let snapshot = empty(), owner: Identity | null = null, generation = 0, active = true;
  const listeners = new Set<() => void>();
  const identity = (): Identity | null => {
    try {
      const next = deps.currentIdentity();
      return next && id(next.actorId) && id(next.shopId) ? { actorId: next.actorId, shopId: next.shopId } : null;
    } catch { return null; }
  };
  const publish = (next: ServiceCreateFenceSnapshot) => {
    snapshot = Object.freeze(next);
    // A rendering subscriber cannot reinterpret or interrupt a command result.
    for (const listener of [...listeners]) { try { listener(); } catch { /* Next subscription reads the stable snapshot. */ } }
  };
  const synchronize = () => {
    const next = identity();
    if (!sameIdentity(owner, next)) {
      generation++;
      owner = next;
      publish(empty());
    }
  };
  const current = (version: number, actor: Identity) => {
    if (!active) return false;
    synchronize();
    return active && generation === version && sameIdentity(owner, actor);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    // Explicit activation also supports React StrictMode effect cleanup/setup.
    // A late request never calls this public method and cannot reactivate disposal.
    syncIdentity() { active = true; synchronize(); },
    async submit(payload: CreateServiceDto): Promise<void> {
      if (!active) return;
      synchronize();
      if (!owner || !['IDLE', 'REJECTED'].includes(snapshot.state)) return;
      const actor = { ...owner }, version = generation;
      let submitted: CreateServiceDto;
      try { submitted = immutableClone(payload); }
      catch { publish({ state: 'REJECTED', payload: null, result: null, error: '新建草稿无法提交，请核对填写内容。' }); return; }
      // Publish synchronously before create/await, including subscriber re-entry.
      publish({ state: 'IN_FLIGHT', payload: submitted, result: null, error: '' });
      if (!current(version, actor) || snapshot.state !== 'IN_FLIGHT') return;
      let value: ServiceItem;
      try { value = await deps.create(actor.shopId, submitted); }
      catch (error) {
        if (!current(version, actor)) return;
        const status = rejectedStatus(error);
        publish({ state: status === null ? 'UNKNOWN' : 'REJECTED', payload: submitted, result: null,
          error: status === null ? unknownMessage : `服务器已拒绝本次新建（HTTP ${status}），请核对草稿后再提交。` });
        return;
      }
      if (!current(version, actor)) return;
      try {
        deps.verify(value, actor.shopId, submitted);
        const result = immutableClone(value);
        if (current(version, actor)) publish({ state: 'APPLIED', payload: submitted, result, error: '' });
      } catch {
        // A 2xx receipt that cannot be trusted never becomes a safe retry, even
        // if a validator happens to throw an object containing a 4xx status.
        if (current(version, actor)) publish({ state: 'UNKNOWN', payload: submitted, result: null, error: unknownMessage });
      }
    },
    finish(acknowledgeUnknown = false): boolean {
      if (!active) return false;
      synchronize();
      if (!['APPLIED', 'REJECTED'].includes(snapshot.state) && !(snapshot.state === 'UNKNOWN' && acknowledgeUnknown === true)) return false;
      generation++;
      publish(empty());
      return true;
    },
    dispose() {
      active = false;
      generation++;
      owner = null;
      snapshot = empty();
      listeners.clear();
    },
  };
}
