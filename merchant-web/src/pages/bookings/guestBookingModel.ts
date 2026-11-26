import { checkedGuestCommand, createGuestBooking, queryGuestBooking, reconcileGuestBooking, requireGuestOperation, type GuestBookingCommand, type GuestBookingOperation, type GuestBookingReceipt } from '../../api/bookings';
import { currentSessionGeneration, isCurrentSession } from '../../api/client';

interface Pending { command: GuestBookingCommand; notExecuted: boolean }
interface State { pending: Pending | null; receipt: GuestBookingReceipt | null; busy: boolean; corrupt: boolean; error: string }
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Dependencies { storage?: RecoveryStorage; submit?: typeof createGuestBooking; query?: typeof queryGuestBooking; reconcile?: typeof reconcileGuestBooking }
export const guestRecoveryKey = (actorId: string, shopId: string) => `massajoy2:guest-assisted-booking:${actorId}:${shopId}`;
const frozen = (command: GuestBookingCommand): GuestBookingCommand => Object.freeze({ ...command, contact: Object.freeze({ ...command.contact }), preferredTherapistIds: Object.freeze([...(command.preferredTherapistIds ?? [])]) as unknown as string[] });
export function createGuestBookingModel(actorId: string, shopId: string, authorized: () => boolean, dependencies: Dependencies = {}) {
  const storage = dependencies.storage ?? globalThis.sessionStorage, submit = dependencies.submit ?? createGuestBooking, query = dependencies.query ?? queryGuestBooking, reconcile = dependencies.reconcile ?? reconcileGuestBooking;
  const key = guestRecoveryKey(actorId, shopId), session = currentSessionGeneration(), listeners = new Set<() => void>();
  let state: State = { pending: null, receipt: null, busy: false, corrupt: false, error: '' }, active = true, generation = 0;
  const current = () => active && isCurrentSession(session) && authorized();
  const update = (patch: Partial<State>) => { if (current()) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); } };
  const persist = (pending: Pending, receipt?: GuestBookingReceipt) => storage.setItem(key, JSON.stringify({ actorId, shopId, ...pending, ...(receipt ? { receipt } : {}) }));
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.actorId !== actorId || saved.shopId !== shopId || typeof saved.notExecuted !== 'boolean') throw new Error();
      const command = frozen(checkedGuestCommand(saved.command));
      state.pending = { command, notExecuted: false };
      if (saved.receipt) { const receipt = requireGuestOperation(saved.receipt, shopId, command, true); if (receipt.outcome !== 'COMMITTED') throw new Error(); state.receipt = receipt; }
    }
  } catch { state.corrupt = true; state.error = '首次客预约恢复标记无法读取。为防止重复下单，已停止创建；请先核对本店订单并由管理员恢复原请求标记。'; }
  const committed = (receipt: GuestBookingReceipt, pending: Pending) => {
    // Keep the successful receipt until the merchant explicitly acknowledges it.
    // A refresh after response loss must reopen the same result, never a fresh form.
    persist(pending, receipt); update({ receipt, pending, busy: false, error: '' });
  };
  const releaseBusy = (version: number) => { if (active && version === generation && isCurrentSession(session) && state.busy) { state = { ...state, busy: false }; listeners.forEach(listener => listener()); } };
  const execute = async (value: GuestBookingCommand) => {
    if (!current() || state.busy || state.pending || state.receipt || state.corrupt) return;
    let command: GuestBookingCommand;
    try { command = frozen(checkedGuestCommand(value)); if (Date.parse(command.quoteExpiresAt) <= Date.now()) throw new Error('报价已过期，请重新核价。'); }
    catch (error) { update({ error: error instanceof Error ? error.message : '请重新核价。' }); return; }
    const pending = { command, notExecuted: false };
    try { persist(pending); } catch { update({ error: '浏览器无法保存原联系人和防重复请求，尚未发送预约。请允许本地会话存储后重试。' }); return; }
    const version = ++generation; update({ pending, busy: true, error: '' });
    try {
      const result = requireGuestOperation(await submit(shopId, command), shopId, command, true);
      if (result.outcome !== 'COMMITTED') throw new Error('未取得创建回执。');
      if (current() && version === generation) committed(result, pending);
    } catch (error) { if (current() && version === generation) update({ error: (error instanceof Error ? error.message + ' ' : '') + '原请求结果尚未确认；请查询原请求，不能另建第二单。' }); }
    finally { releaseBusy(version); }
  };
  const settle = async (fence: boolean) => {
    if (!current() || state.busy || !state.pending || state.receipt || state.corrupt) return;
    const pending = state.pending, version = ++generation; update({ busy: true, error: '' });
    try {
      const result: GuestBookingOperation = requireGuestOperation(await (fence ? reconcile : query)(shopId, pending.command), shopId, pending.command, fence);
      if (!current() || version !== generation) return;
      if (result.outcome === 'COMMITTED') committed(result, pending);
      else if (result.outcome === 'NOT_EXECUTED') { const resolved = { ...pending, notExecuted: true }; persist(resolved); update({ pending: resolved, error: '服务端已确认未创建预约并封存原请求编号。明确恢复原草稿后，须重新核价并使用新请求编号。' }); }
      else update({ error: '尚未找到回执，这不能证明未创建。请使用“锁定核对原请求”确认，原联系人和请求编号继续保留。' });
    } catch (error) { if (current() && version === generation) update({ error: (error instanceof Error ? error.message + ' ' : '') + '防重复标记仍保留，请稍后继续核对。' }); }
    finally { releaseBusy(version); }
  };
  const clear = (success: boolean) => {
    if (!current() || state.busy || state.corrupt || (success ? !state.receipt : !state.pending?.notExecuted)) return false;
    try { storage.removeItem(key); update({ pending: null, receipt: null, error: '' }); return true; }
    catch { update({ error: '无法清除原请求标记，请保留此页面继续核对，避免重复创建。' }); return false; }
  };
  return { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSnapshot: () => state,
    execute, query: () => settle(false), reconcile: () => settle(true), resumeDraft: () => clear(false), acknowledge: () => clear(true),
    dispose: () => { active = false; generation++; }, activate: () => { active = true; } };
}
