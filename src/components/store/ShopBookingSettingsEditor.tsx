import { useEffect, useRef, useState } from 'react';
import { EMPTY_RESERVATION_BOOKING_SETTINGS, getShopBookingSettingsSnapshot, updateShopBookingSettings, type ReservationShopBookingSettings } from '../../api/reservations';
import type { ResourceId } from '../../api/resources';
import { EMPTY_BUSINESS_LIFECYCLE, useBusinessScope, type BusinessLifecycleListener } from './businessScope';
import { bookingTimezoneValid, checkedShopBookingSettings, closureAnnouncement, nextClosurePeriod, noticeInputMinutes } from '../../utils/shopBookingSettings';
import { useConfirmation } from '../Confirmation';

export default function ShopBookingSettingsEditor({ shopId, timezone, phone, disabled = false, onLifecycleChange }: { shopId: ResourceId; timezone: string | null; phone?: string; disabled?: boolean; onLifecycleChange?: BusinessLifecycleListener }) {
  const scope = useBusinessScope(shopId), identity = String(scope.actorId) + ':' + String(shopId), confirm = useConfirmation();
  const mounted = useRef(true), operation = useRef<symbol | null>(null), live = useRef({ identity, generation: 0, disabled });
  const unknownWrite = useRef(false), reviewedValue = useRef<ReservationShopBookingSettings | null>(null);
  const settingsHash = useRef(''), reviewedHash = useRef('');
  if (live.current.identity !== identity) { live.current = { identity, generation: live.current.generation + 1, disabled }; operation.current = null; unknownWrite.current = false; reviewedValue.current = null; }
  else live.current.disabled = disabled;
  const capture = () => { const generation = live.current.generation, currentScope = scope.capture(); return () => mounted.current && identity === live.current.identity && generation === live.current.generation && currentScope(); };
  const [saved, setSaved] = useState<ReservationShopBookingSettings>(EMPTY_RESERVATION_BOOKING_SETTINGS), [draft, setDraft] = useState<ReservationShopBookingSettings>(EMPTY_RESERVATION_BOOKING_SETTINGS);
  const [loading, setLoading] = useState(true), [loadedIdentity, setLoadedIdentity] = useState<string | null>(null), [saving, setSaving] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reviewed, setReviewed] = useState<ReservationShopBookingSettings | null>(null), [confirming, setConfirming] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [noticeHours, setNoticeHours] = useState('0');
  const loaded = loadedIdentity === identity && scope.actorId !== null;
  let noticeDirty = true;
  try { noticeDirty = noticeInputMinutes(noticeHours, 60) !== saved.minimumNoticeMinutes; } catch { /* Keep incomplete input as an unsaved draft. */ }
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft) || noticeDirty, locked = disabled || loading || !loaded || saving || unknown || confirming;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onLifecycleChange?.({ dirty, busy: saving || loading || confirming, unknown }); }, [dirty, saving, loading, confirming, unknown, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange?.(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  const refresh = async (current: () => boolean, signal?: AbortSignal) => {
    const snapshot = await getShopBookingSettingsSnapshot(shopId, signal), value = snapshot.bookingSettings;
    if (!signal?.aborted && current()) { settingsHash.current = snapshot.bookingSettingsHash; setSaved(structuredClone(value)); setDraft(structuredClone(value)); setNoticeHours(String(value.minimumNoticeMinutes / 60)); setLoadedIdentity(identity); setConflict(false); }
  };
  useEffect(() => {
    const abort = new AbortController(), current = capture(), token = Symbol('read-booking-settings'); operation.current = token;
    setLoading(true); setLoadedIdentity(null); setSaving(false); setUnknown(false); unknownWrite.current = false; setReviewed(null); reviewedValue.current = null; setConfirming(false); setError(''); setNotice('');
    setSaved(EMPTY_RESERVATION_BOOKING_SETTINGS); setDraft(EMPTY_RESERVATION_BOOKING_SETTINGS); setNoticeHours('0'); settingsHash.current = ''; reviewedHash.current = ''; setConflict(false);
    if (!current()) { operation.current = null; setLoading(false); return () => abort.abort(); }
    void refresh(current, abort.signal).catch(e => { if (!abort.signal.aborted && current() && operation.current === token) setError(e instanceof Error ? e.message : '预约规则读取失败。'); })
      .finally(() => { if (!abort.signal.aborted && current() && operation.current === token) { operation.current = null; setLoading(false); } });
    return () => abort.abort();
  }, [identity]);
  const update = (next: ReservationShopBookingSettings) => { if (!locked && !operation.current && !unknownWrite.current && !live.current.disabled && capture()()) { setDraft(next); setError(''); setNotice(''); } };
  const addClosedPeriod = () => {
    try { update({ ...draft, closedPeriods: [...draft.closedPeriods, nextClosurePeriod(draft.closedPeriods, timezone)] }); }
    catch (e) { setError(e instanceof Error ? e.message : '请核对门店时区及已有闭店日期。'); }
  };
  const save = async () => {
    const current = capture();
    if (operation.current || unknownWrite.current || locked || conflict || !dirty || live.current.disabled || !current()) return;
    let settings: ReservationShopBookingSettings;
    try { settings = checkedShopBookingSettings({ ...draft, minimumNoticeMinutes: noticeInputMinutes(noticeHours, 60) }); }
    catch (e) { setError(e instanceof Error ? e.message : '请核对预约提前量以及每段闭店起止日期。'); return; }
    const token = Symbol('save-booking-settings'); operation.current = token; setSaving(true); setError(''); setNotice(''); setUnknown(false); setReviewed(null); reviewedValue.current = null;
    try { const snapshot = await updateShopBookingSettings(shopId, settings, settingsHash.current), value = snapshot.bookingSettings; if (!current() || operation.current !== token) return; settingsHash.current = snapshot.bookingSettingsHash; setSaved(structuredClone(value)); setDraft(structuredClone(value)); setNoticeHours(String(value.minimumNoticeMinutes / 60)); setNotice('预约提前时间与临时闭店已保存。'); }
    catch (e) { if (!current() || operation.current !== token) return; const status = (e as { status?: number })?.status, ambiguous = !status || status === 408 || status >= 500; if (status === 409) setConflict(true); if (ambiguous) { unknownWrite.current = true; setUnknown(true); } setError((e instanceof Error ? e.message : '保存结果未能确认。') + (ambiguous ? '请只读重新载入核对，明确结束本次操作后再修改。' : status === 409 ? '原草稿已保留。请重新读取最新规则后手动合并，避免覆盖刚新增的闭店。' : '')); }
    finally { if (current() && operation.current === token) { operation.current = null; setSaving(false); } }
  };
  const reload = async () => {
    const current = capture(); if (operation.current || saving || loading || !current()) return;
    const token = Symbol('reload-booking-settings'); operation.current = token; setLoading(true); setError(''); setNotice(''); setReviewed(null); reviewedValue.current = null;
    try {
      if (unknownWrite.current) {
        const snapshot = await getShopBookingSettingsSnapshot(shopId), value = snapshot.bookingSettings;
        if (!current() || operation.current !== token) return;
        reviewedValue.current = value; reviewedHash.current = snapshot.bookingSettingsHash; setReviewed(value);
      } else if (conflict) {
        const snapshot = await getShopBookingSettingsSnapshot(shopId);
        if (!current() || operation.current !== token) return;
        reviewedHash.current = snapshot.bookingSettingsHash; reviewedValue.current = snapshot.bookingSettings; setReviewed(snapshot.bookingSettings);
        setNotice('最新已保存规则已显示，原草稿仍保留。请明确合并闭店日期或采用最新规则，再继续保存。');
      } else { await refresh(current); if (current() && operation.current === token) setNotice('预约规则已从服务器重新载入。'); }
    } catch (e) { if (current() && operation.current === token) setError('重新载入失败；原草稿保留。' + (e instanceof Error ? e.message : '')); }
    finally { if (current() && operation.current === token) { operation.current = null; setLoading(false); } }
  };
  const adoptLatest = (merge: boolean) => {
    if (!conflict || !reviewed || reviewedValue.current !== reviewed || locked || operation.current || !capture()()) return;
    try {
      const periods = [...reviewed.closedPeriods, ...draft.closedPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate));
      const combined: ReservationShopBookingSettings['closedPeriods'] = [];
      for (const period of periods) { const previous = combined.at(-1); if (previous && period.startDate <= previous.endDate) { if (period.endDate > previous.endDate) previous.endDate = period.endDate; } else combined.push({ ...period }); }
      const next = merge ? checkedShopBookingSettings({ minimumNoticeMinutes: noticeInputMinutes(noticeHours, 60), closedPeriods: combined }) : reviewed;
      settingsHash.current = reviewedHash.current; setSaved(structuredClone(reviewed)); setDraft(structuredClone(next)); setNoticeHours(String(next.minimumNoticeMinutes / 60));
      setConflict(false); setReviewed(null); reviewedValue.current = null; setError(''); setNotice(merge ? '双方闭店日期已合并，原草稿提前量保留；请核对后保存。' : '已采用最新规则，原草稿已放弃。');
    } catch (error) { setError(error instanceof Error ? error.message : '合并失败，原草稿保留。'); }
  };
  const finishReview = async () => {
    const current = capture();
    if (operation.current || !unknownWrite.current || !reviewed || reviewedValue.current !== reviewed || !current()) return;
    const token = Symbol('review-booking-settings'); operation.current = token; setConfirming(true);
    try {
      if (!await confirm({ title: '结束本次预约规则核对？', message: '原保存可能仍会完成；结束核对不会撤销原操作。请先比较保留的输入与最新规则，结束后将以本次读取的规则继续编辑。', confirmLabel: '已核对，结束本次操作' })) return;
      if (!current() || operation.current !== token || reviewedValue.current !== reviewed) return;
      setSaved(structuredClone(reviewed)); setDraft(structuredClone(reviewed)); setNoticeHours(String(reviewed.minimumNoticeMinutes / 60));
      settingsHash.current = reviewedHash.current;
      unknownWrite.current = false; setUnknown(false); reviewedValue.current = null; setReviewed(null); setError(''); setNotice('已结束本次核对，请依据最新规则继续编辑。');
    } finally { if (current() && operation.current === token) { operation.current = null; setConfirming(false); } }
  };
  return <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="预约提前量与临时闭店">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-800">预约提前量与临时闭店</h3><p className="mt-1 text-sm leading-6 text-slate-500">按门店当地时间生效；如闭店日期内已有有效预约，请先联系顾客处理，再添加闭店。系统不会自动取消预约。</p></div><button type="button" disabled={locked || conflict || !dirty} onClick={() => void save()} className="store-primary-button">{saving ? '保存中…' : '保存预约规则'}</button></div>
    {conflict && <div className="mb-3 flex flex-wrap gap-2"><button type="button" disabled={saving || loading || confirming} onClick={() => void reload()} className="store-secondary-button">重读最新规则并保留草稿</button>{reviewed && <><button type="button" disabled={locked} onClick={() => adoptLatest(true)} className="store-secondary-button">合并最新闭店日期</button><button type="button" disabled={locked} onClick={() => adoptLatest(false)} className="store-secondary-button">放弃草稿并采用最新规则</button></>}</div>}
    {reviewed && !unknown && <div aria-label="最新已保存预约规则" className="mb-3 rounded-lg border border-amber-200 p-3 text-sm"><strong>最新已保存预约规则（请与草稿合并）</strong><p>最短提前预约时间：{reviewed.minimumNoticeMinutes / 60} 小时</p>{reviewed.closedPeriods.map(period => <p key={period.startDate + ':' + period.endDate}>{period.startDate} — {period.endDate}</p>)}</div>}
    {unknown && <div className="mb-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><p>上次保存结果未知，原草稿已保留；只读重新载入后仍须明确结束核对。</p>{reviewed && <div aria-label="最新已保存预约规则" className="space-y-1 rounded-lg border border-amber-200 bg-white/60 p-3"><p className="font-medium">最新已保存预约规则</p><p>最短提前预约时间：{reviewed.minimumNoticeMinutes / 60} 小时</p>{reviewed.closedPeriods.length ? reviewed.closedPeriods.map(period => <p key={period.startDate + ':' + period.endDate} lang="en">{closureAnnouncement(period, phone)}</p>) : <p>暂无临时闭店日期。</p>}</div>}<div className="flex flex-wrap gap-2"><button type="button" disabled={saving || loading || confirming} onClick={() => void reload()} className="store-secondary-button">只读重新载入并核对</button><button type="button" disabled={saving || loading || confirming || !reviewed} onClick={() => void finishReview()} className="store-secondary-button">已核对，结束本次操作</button></div></div>}
    {!loading && !loaded && <p className="mb-3 text-sm text-amber-800">预约规则尚未成功读取，暂不能编辑，避免覆盖原设置。<button type="button" onClick={() => void reload()} className="store-secondary-button ml-2">重新读取预约规则</button></p>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mb-3 text-sm text-teal-700">{notice}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <div><label htmlFor={`booking-notice-${shopId}`} className="mb-2 block text-sm font-medium text-slate-700">最短提前预约时间</label><div className="flex max-w-sm items-center gap-3"><input id={`booking-notice-${shopId}`} type="number" min={0} max={168} step="any" disabled={locked} value={noticeHours} onChange={event => { if (locked || operation.current || unknownWrite.current || live.current.disabled || !capture()()) return; setNoticeHours(event.target.value); setError(''); setNotice(''); }} className="store-control" /><span className="text-sm text-slate-500">小时</span></div><p className="mt-2 text-xs leading-5 text-slate-500">例如设置 12 小时，当前时刻之后不足 12 小时的所有时段都不可预约；系统显示其后第一个同时满足营业、技师和场地条件的时段。</p></div>
      <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><strong className="text-sm font-medium text-slate-700">临时闭店</strong><button type="button" disabled={locked || !bookingTimezoneValid(timezone) || draft.closedPeriods.length >= 50} onClick={addClosedPeriod} className="store-secondary-button">添加闭店日期</button></div><p className="mb-3 text-xs leading-5 text-slate-500">包含开始和结束日期。访客会看到英文闭店公告及门店联系电话；闭店期间停止新预约。{!bookingTimezoneValid(timezone) && '请先在基本资料中设置门店时区，再添加日期。'}</p>
        {draft.closedPeriods.length ? <div className="grid gap-2">{draft.closedPeriods.map((period, index) => <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3"><label className="grid flex-1 gap-1 text-xs text-slate-500">开始日期<input aria-label={`闭店第${index + 1}段开始日期`} type="date" disabled={locked} value={period.startDate} onChange={event => update({ ...draft, closedPeriods: draft.closedPeriods.map((item, at) => at === index ? { ...item, startDate: event.target.value } : item) })} className="store-control" /></label><label className="grid flex-1 gap-1 text-xs text-slate-500">结束日期<input aria-label={`闭店第${index + 1}段结束日期`} type="date" disabled={locked} value={period.endDate} onChange={event => update({ ...draft, closedPeriods: draft.closedPeriods.map((item, at) => at === index ? { ...item, endDate: event.target.value } : item) })} className="store-control" /></label><button type="button" disabled={locked} onClick={() => update({ ...draft, closedPeriods: draft.closedPeriods.filter((_item, at) => at !== index) })} className="store-secondary-button">移除</button>{closureAnnouncement(period, phone) && <p className="w-full text-xs leading-5 text-slate-500" lang="en">{closureAnnouncement(period, phone)}</p>}</div>)}</div> : <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">暂无临时闭店日期。</p>}
        {draft.closedPeriods.length > 0 && <p className="mt-2 text-xs text-slate-500">以上为闭店公告内容预览，保存预约规则后生效。{!phone?.trim() && '门店联系电话未填写，请在基本资料中补充。'}</p>}
      </div>
    </div>
  </section>;
}
