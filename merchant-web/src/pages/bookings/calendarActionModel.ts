import { reconcileCalendarAction, requireCalendarOperation, submitCalendarAction, validateCalendarCommand, type CalendarCommand, type CalendarOperation, type CalendarReceipt } from '../../api/calendarActions';
import { currentSessionGeneration, isCurrentSession } from '../../api/client';

interface Pending { command: CalendarCommand; notExecuted: boolean }
interface State { pending: Pending | null; busy: boolean; error: string; receipt: CalendarReceipt | null; corrupt: boolean }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Dependencies { storage?: Storage; submit?: typeof submitCalendarAction; reconcile?: typeof reconcileCalendarAction }
export function createCalendarActionModel(actorId: string, shopId: string, isCurrent: () => boolean, dependencies: Dependencies = {}) {
  const storage = dependencies.storage ?? globalThis.sessionStorage, submit = dependencies.submit ?? submitCalendarAction, reconcile = dependencies.reconcile ?? reconcileCalendarAction;
  const storageKey = `massajoy2:calendar-action:${actorId}:${shopId}`, session = currentSessionGeneration();
  let state: State = { pending: null, busy: false, error: '', receipt: null, corrupt: false }, active = true, generation = 0;
  const listeners = new Set<() => void>();
  const releaseBusy = (version: number) => { if (active && version === generation && isCurrentSession(session) && state.busy) { state = { ...state, busy: false }; listeners.forEach(listener => listener()); } };
  const current = () => active && isCurrentSession(session) && isCurrent();
  const update = (patch: Partial<State>) => { if (!current()) return; state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  try {
    const raw = storage.getItem(storageKey);
    if (raw) {
      const value = JSON.parse(raw);
      if (value.actorId !== actorId || value.shopId !== shopId || typeof value.notExecuted !== 'boolean') throw new Error();
      validateCalendarCommand(value.command);
      state.pending = { command: Object.freeze(value.command), notExecuted: false }; // Reconcile again after a remount; another tab may have retried.
    }
  } catch { state.corrupt = true; state.error = '无法恢复本店未决日历请求。为防止重复操作，已停止发送新命令；请先核对本店日历并联系管理员恢复原请求标记。'; }
  const persist = (pending: Pending) => storage.setItem(storageKey, JSON.stringify({ actorId, shopId, ...pending }));
  const committed = (receipt: CalendarReceipt) => { storage.removeItem(storageKey); update({ pending: null, busy: false, receipt, error: '' }); };
  const execute = async (command?: CalendarCommand, retry = false) => {
    if (!current() || state.busy || state.corrupt || (state.pending && !retry) || (!state.pending && retry)) return;
    // Reconciliation writes a NOT_EXECUTED fence. That key can never execute
    // later, so an explicitly requested retry copies its parameters to a new key.
    const original = retry ? { ...state.pending!.command, requestKey: crypto.randomUUID() } : command!;
    try { validateCalendarCommand(original); } catch (error) { update({ error: error instanceof Error ? error.message : '日历参数无效。' }); return; }
    const pending = { command: Object.freeze({ ...original }), notExecuted: false };
    try { persist(pending); } catch { update({ error: '浏览器无法保存防重复标记，尚未发送日历操作。' }); return; }
    update({ pending, busy: true, error: '', receipt: null });
    const version = ++generation;
    try { const receipt = requireCalendarOperation(await submit(shopId, pending.command), shopId, pending.command, true); if (receipt.outcome !== 'COMMITTED') throw new Error('写入未取得成功回执。'); if (current() && version === generation) committed(receipt); }
    catch (error) {
      if (!current() || version !== generation) return;
      // Even a failed retry/403 can happen before idempotency lookup. Only a
      // transaction-locked reconciliation can prove the original did not run.
      update({ busy: false, error: (error instanceof Error ? error.message + ' ' : '') + '原请求结果尚未确认，已保留同一请求；请查询确定结果，不要另建区间。' });
    } finally { releaseBusy(version); }
  };
  const settle = async () => {
    if (!current() || state.busy || !state.pending || state.corrupt) return;
    const command = state.pending.command, version = ++generation;
    update({ busy: true, error: '' });
    try {
      const result: CalendarOperation = requireCalendarOperation(await reconcile(shopId, command), shopId, command, true);
      if (!current() || version !== generation) return;
      if (result.outcome === 'COMMITTED') committed(result);
      else if (result.outcome === 'NOT_EXECUTED') {
        const pending = { command, notExecuted: true }; persist(pending);
        update({ busy: false, pending, error: '服务端已确认原请求未执行并封存原请求编号。可按原参数重新提交（新编号），或明确放弃后继续编辑。' });
      } else update({ busy: false, error: '尚未取得确定结果，原请求仍保留。' });
    } catch (error) { if (current() && version === generation) update({ busy: false, error: (error instanceof Error ? error.message + ' ' : '') + '未决标记仍保留。' }); }
    finally { releaseBusy(version); }
  };
  return { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSnapshot: () => state,
    execute: (command: CalendarCommand) => execute(command), retry: () => state.pending?.notExecuted ? execute(undefined, true) : Promise.resolve(), reconcile: settle,
    discard: () => { if (!current() || state.busy || !state.pending?.notExecuted) return false; try { storage.removeItem(storageKey); update({ pending: null, error: '' }); return true; } catch { update({ error: '无法清除防重复标记，原请求仍保留。' }); return false; } },
    clearReceipt: () => update({ receipt: null }), dispose: () => { active = false; generation++; }, activate: () => { active = true; } };
}
