import { useCallback, useEffect, useMemo, useState } from 'react';
import StoreTechnicians from '../StoreTechnicians';
import ReservationSettings from '../ReservationSettings';
import type { ReadinessTab } from '../../api/shopReadiness';
import type { StoreItem } from './types';
import { EMPTY_BUSINESS_LIFECYCLE, type BusinessLifecycle, type BusinessLifecycleListener } from './businessScope';

export type StoreBusinessTab = 'services' | 'technicians' | 'reservations';
export interface StoreBusinessTarget { tab: StoreBusinessTab; reservationTab?: ReadinessTab; serviceId?: string; therapistId?: string; }
const tabs: Array<{ id: StoreBusinessTab; label: string }> = [{ id: 'technicians', label: '技师人数' }, { id: 'reservations', label: '其他设置（可选）' }];

export default function StoreBusinessSettings({ item, initialTarget, onLifecycleChange, onChanged, onOpenPriceMenu }: { item: StoreItem; initialTarget?: StoreBusinessTarget; onLifecycleChange: BusinessLifecycleListener; onChanged: () => void; onOpenPriceMenu: () => void }) {
  const [target, setTarget] = useState<StoreBusinessTarget>(initialTarget ?? { tab: 'technicians' });
  const [visited, setVisited] = useState<Partial<Record<StoreBusinessTab, boolean>>>({ [initialTarget?.tab ?? 'technicians']: true });
  const [states, setStates] = useState<Record<StoreBusinessTab, BusinessLifecycle>>({ services: EMPTY_BUSINESS_LIFECYCLE, technicians: EMPTY_BUSINESS_LIFECYCLE, reservations: EMPTY_BUSINESS_LIFECYCLE });
  const [notice, setNotice] = useState(''), [revision, setRevision] = useState(0), [staffingRevision, setStaffingRevision] = useState(0), [selectionRevision, setSelectionRevision] = useState(0);
  const state = useMemo(() => ({ dirty: Object.values(states).some(item => item.dirty), busy: Object.values(states).some(item => item.busy), unknown: Object.values(states).some(item => item.unknown) }), [states]);
  const reportTechnicians = useCallback((value: BusinessLifecycle) => setStates(previous => ({ ...previous, technicians: value })), []);
  const reportReservations = useCallback((value: BusinessLifecycle) => setStates(previous => ({ ...previous, reservations: value })), []);
  useEffect(() => { onLifecycleChange(state); }, [state, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  useEffect(() => { if (initialTarget) { setSelectionRevision(value => value + 1); setTarget(initialTarget); setVisited(previous => ({ ...previous, [initialTarget.tab]: true })); } }, [initialTarget]);
  const changed = useCallback(() => { setRevision(value => value + 1); onChanged(); }, [onChanged]);
  const reservationsChanged = useCallback(() => { setStaffingRevision(value => value + 1); onChanged(); }, [onChanged]);
  useEffect(() => { if (target.tab === 'services' || target.tab === 'reservations' && target.reservationTab === 'services') onOpenPriceMenu(); }, [target]);
  const navigate = (next: StoreBusinessTarget, completingImport = false) => {
    if ((!completingImport && state.busy) || state.unknown || state.dirty) { setNotice(state.unknown ? '请先核对并明确结束结果未知的草稿，再切换配置。' : state.busy ? '当前操作尚未完成，请稍后切换。' : '请先保存或取消当前业务草稿，再切换配置。'); return; }
    setNotice(''); setSelectionRevision(value => value + 1); setTarget(next); setVisited(previous => ({ ...previous, [next.tab]: true }));
  };
  return <section className="space-y-5" aria-label={item.name + '业务配置'}>
    <div><h3 className="text-lg font-semibold text-slate-900">{target.tab === 'technicians' ? '技师管理' : '其他营业设置'}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{target.tab === 'technicians' ? '设置人数即可，个人资料和特殊安排均为可选。' : '按需设置空间和个人例外，门店资料草稿继续保留。'}</p></div>
    <div role="tablist" aria-label="本店业务配置" className="flex flex-wrap gap-2">{tabs.map(tab => <button key={tab.id} id={'store-business-tab-' + tab.id} type="button" role="tab" aria-selected={target.tab === tab.id} aria-controls={'store-business-panel-' + tab.id} onClick={() => navigate({ tab: tab.id })} className={'rounded-lg px-4 py-2.5 text-sm font-medium ' + (target.tab === tab.id ? 'bg-teal-700 text-white' : 'border border-slate-200 bg-white text-slate-600')}>{tab.label}</button>)}</div>
    {target.tab !== 'technicians' && <button type="button" className="store-secondary-button" onClick={onOpenPriceMenu}>管理项目与价目</button>}
    {notice && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{notice}</p>}
    <div id="store-business-panel-technicians" role="tabpanel" aria-labelledby="store-business-tab-technicians" hidden={target.tab !== 'technicians'}>{visited.technicians && <StoreTechnicians shopId={item.id} embedded refreshRevision={staffingRevision} onStoreList={() => {}} onBack={() => {}} onLifecycleChange={reportTechnicians} onChanged={changed} onReservations={(_shopId, therapistId) => navigate({ tab: 'reservations', reservationTab: 'therapists', therapistId })} />}</div>
    <div id="store-business-panel-reservations" role="tabpanel" aria-labelledby="store-business-tab-reservations" hidden={target.tab !== 'reservations'}>{visited.reservations && <ReservationSettings explicitShopId={item.id} embedded resourcesOnly initialTab={target.reservationTab === 'services' ? 'therapists' : target.reservationTab ?? 'rooms'} initialServiceId={target.serviceId} initialTherapistId={target.therapistId} onBack={() => {}} onManageQualifications={() => navigate({ tab: 'technicians' })} onLifecycleChange={reportReservations} onChanged={reservationsChanged} revision={revision} selectionRevision={selectionRevision} />}</div>
  </section>;
}
