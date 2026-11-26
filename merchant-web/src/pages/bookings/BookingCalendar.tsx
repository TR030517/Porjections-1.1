import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Select, Space, Spin, Tag } from 'antd';
import { LeftOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import type { CalendarEvent, CalendarResource, CalendarResourceType } from '../../api/bookingCalendar';
import { currentShopAllows, isCurrentShop } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import { displayLabel } from '../../utils/displayLabels';
import { shopLocal } from '../../utils/reservationTime';
import { addDays, bookingCount, calendarRange, createCalendarModel, datesInRange, eventsForResourceColumn, eventsOnDate, moveAnchor, validDate, type CalendarView } from './calendarModel';
import './calendar.css';
import CalendarActionsPanel, { type CalendarAssistedSelection } from './CalendarActionsPanel';

const typeLabels = { BOOKING: '预约', SHOP_CLOSURE: '整日闭店', THERAPIST_TIME_OFF: '技师请假', ROOM_MAINTENANCE: '场地维护', INTERNAL_OCCUPANCY: '内部占用', TIME_BLOCK: '时段停约' };
const blockStatusLabels: Record<string, string> = { CLOSED: '已闭店', TIME_OFF: '请假', MAINTENANCE: '维护' };
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const viewOptions = [{ value: 'month', label: '月' }, { value: 'week', label: '周' }, { value: 'day', label: '日' }, { value: 'list', label: '日程列表' }];
const statusOptions = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'].map(value => ({ value, label: displayLabel(value) }));
const minAnchor = '1900-02-01', maxAnchor = '9999-11-30';
const allowedAnchor = (date: string) => validDate(date) && date >= minAnchor && date <= maxAnchor;
function dateLabel(date: string) { return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 ${weekdays[new Date(date + 'T00:00:00Z').getUTCDay()]}`; }
function resourceLabel(event: CalendarEvent) {
  return event.resources.map(value => `${value.type === 'THERAPIST' ? '技师' : '场地'} ${value.name}`).join(' · ')
    || (['SHOP_CLOSURE', 'INTERNAL_OCCUPANCY', 'TIME_BLOCK'].includes(event.eventType) ? '全店' : '未分配资源');
}
function intervalText(start: string, end: string, timezone: string) {
  const from = shopLocal(start, timezone), to = shopLocal(end, timezone);
  const offset = (instant: string) => new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'shortOffset' }).formatToParts(new Date(instant)).find(part => part.type === 'timeZoneName')?.value ?? '';
  const fromOffset = offset(start), toOffset = offset(end);
  return `${from.slice(11)}–${from.slice(0, 10) === to.slice(0, 10) ? to.slice(11) : to.replace('T', ' ')} (${fromOffset !== toOffset ? `${fromOffset} → ${toOffset}` : fromOffset})`;
}
interface Props { shopId: string; shopName: string; timezone?: string | null; disabled: boolean; revision: number; onOpenBooking: (id: string) => void; onAssisted?: (selection: CalendarAssistedSelection) => void; onActionLockChange?: (locked: boolean) => void }
export default function BookingCalendar(props: Props) {
  let timezone = props.timezone;
  try { if (!timezone) throw new Error(); shopLocal(new Date().toISOString(), timezone); } catch { timezone = null; }
  if (!timezone) return <Alert type="error" showIcon title="门店时区未配置或无效，暂不能读取日历。" description="请先在门店基本资料中修正时区。订单历史列表仍可查看明确标注的时间。" />;
  return <CalendarWorkspace key={`${props.shopId}:${timezone}`} {...props} timezone={timezone} />;
}
function CalendarWorkspace({ shopId, shopName, timezone, disabled: parentDisabled, revision, onOpenBooking, onAssisted, onActionLockChange }: Props & { timezone: string }) {
  const [actionLocked, setActionLocked] = useState(false);
  const actionLockRef = useRef(false);
  const updateActionLock = useCallback((locked: boolean) => { actionLockRef.current = locked; setActionLocked(locked); onActionLockChange?.(locked); }, [onActionLockChange]);
  const disabled = parentDisabled || actionLocked;
  const actorId = useAuthStore(state => state.merchant?.id);
  const [anchor, setAnchor] = useState(() => shopLocal(new Date().toISOString(), timezone).slice(0, 10));
  const [view, setView] = useState<CalendarView>(() => typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches ? 'day' : 'month');
  const [status, setStatus] = useState<string>(), [resourceKey, setResourceKey] = useState<string>();
  const [groupBy, setGroupBy] = useState<CalendarResourceType | 'TIME'>('TIME');
  const [selectedDate, setSelectedDate] = useState<string>(), [selectedBlock, setSelectedBlock] = useState<CalendarEvent>();
  const [selectedTime, setSelectedTime] = useState<string>();
  const model = useMemo(() => createCalendarModel(shopId, calendarRange(anchor, view), () => actorId === useAuthStore.getState().merchant?.id && isCurrentShop(shopId) && currentShopAllows(shopId, 'BOOKINGS_READ')), [actorId, shopId, timezone]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const range = calendarRange(anchor, view), resourceParts = resourceKey?.split(':');
  useEffect(() => {
    setSelectedDate(undefined); setSelectedBlock(undefined);
    void model.load({ ...calendarRange(anchor, view), ...(status ? { status } : {}), ...(resourceParts ? { resourceType: resourceParts[0] as CalendarResourceType, resourceId: resourceParts[1] } : {}) });
    return () => model.dispose();
  }, [model, anchor, view, status, resourceKey, revision]);
  const timezoneChanged = !!state.data && state.data.timezone !== timezone;
  const ready = state.data !== null && !state.loading && !state.error && actorId === useAuthStore.getState().merchant?.id && currentShopAllows(shopId, 'BOOKINGS_READ') && !timezoneChanged
    && state.query.startDate === range.startDate && state.query.endDate === range.endDate && state.query.status === status
    && state.query.resourceType === resourceParts?.[0] && state.query.resourceId === resourceParts?.[1];
  const data = ready ? state.data! : null;
  useEffect(() => {
    if (data) setSelectedBlock(previous => previous ? data.events.find(event => event.id === previous.id && !event.bookingId) : undefined);
  }, [data]);
  const today = shopLocal(data?.serverNow ?? new Date().toISOString(), timezone).slice(0, 10);
  const days = datesInRange(range);
  const events = data?.events ?? [];
  const resources = data?.resources ?? [];
  const canInteract = () => !parentDisabled && !actionLockRef.current && actorId === useAuthStore.getState().merchant?.id && currentShopAllows(shopId, 'BOOKINGS_READ');
  const changeAnchor = (date: string) => { if (canInteract() && allowedAnchor(date)) setAnchor(date); };
  const setMode = (mode: CalendarView) => { if (!canInteract()) return; setView(mode); };
  const openEvent = (event: CalendarEvent, displayedDate?: string) => { if (!canInteract() || !ready) return; if (event.bookingId) onOpenBooking(event.bookingId); else { setSelectedBlock(event); setSelectedDate(event.eventType === 'SHOP_CLOSURE' ? displayedDate : undefined); setSelectedTime(undefined); } };
  const chooseDate = (date: string, time?: string) => { if (!canInteract() || !ready) return; setSelectedDate(date); setSelectedTime(time); setSelectedBlock(undefined); };
  const onDate = (date: string, rows = events) => eventsOnDate(rows, date, timezone);
  const resourceEvents = (resource?: CalendarResource) => eventsForResourceColumn(events, resources, groupBy as CalendarResourceType, resource);
  const eventCard = (event: CalendarEvent, resource?: CalendarResource, compact = false, displayedDate?: string) => {
    const actual = resource && event.resources.find(value => value.type === resource.type && value.id === resource.id);
    const start = actual?.startAt ?? event.startAt, end = actual?.endAt ?? event.endAt;
    return <button type="button" key={event.id} disabled={disabled} className={`booking-calendar-event booking-calendar-event--${event.eventType.toLowerCase()}${compact ? ' booking-calendar-event--compact' : ''}`} onClick={() => openEvent(event, displayedDate)}>
      <span className="booking-calendar-event-meta"><strong>{event.allDay ? '全天' : `${!compact && event.eventType === 'BOOKING' ? event.occupiesResources ? '资源占用 ' : '预约时间 ' : ''}${intervalText(start, end, timezone)}`}</strong><span>{typeLabels[event.eventType]} · {blockStatusLabels[event.status] ?? displayLabel(event.status)}</span></span>
      <span className="booking-calendar-event-title">{event.title}</span>
      {!compact && <><span className="booking-calendar-event-resources">{resourceLabel(event)}</span>
        {event.serviceStartAt && event.serviceEndAt && (event.serviceStartAt !== start || event.serviceEndAt !== end) && <span className="booking-calendar-event-resources">服务 {intervalText(event.serviceStartAt, event.serviceEndAt, timezone)} · 以上区间含资源缓冲</span>}
        {event.expiredHold && <span className="booking-calendar-event-resources">临时保留已到期</span>}{event.occupancySource === 'LEGACY_SERVICE' && <span className="booking-calendar-event-resources">历史资源分配未完整记录 · 按历史预约约束处理</span>}{event.occupiesResources === false && <span className="booking-calendar-event-resources">当前未占用资源</span>}</>}
    </button>;
  };
  const dayGroup = (date: string, rows: CalendarEvent[], resource?: CalendarResource) => {
    const items = onDate(date, rows);
    return <section key={date} className={`booking-calendar-day-section${date === today ? ' is-today' : ''}`}>
      <button type="button" className="booking-calendar-day-heading" disabled={disabled} onClick={() => chooseDate(date)} aria-current={date === today ? 'date' : undefined}><strong>{dateLabel(date)}</strong><span>{bookingCount(items)} 笔预约</span></button>
      <div className="booking-calendar-day-events">{items.length ? items.map(event => eventCard(event, resource, false, date)) : <button type="button" disabled={disabled} className="booking-calendar-empty-date" onClick={() => chooseDate(date)}>该范围未记录事件 · 查看日期</button>}</div>
      {(view === 'week' || view === 'day') && <div className="booking-calendar-hour-picker" aria-label={`${date} 选择时刻`}><small>选择时刻 · 仍需实时核对</small><div>{Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`).map(time => <button type="button" key={time} disabled={disabled} aria-label={`${date} ${time} 门店当地时间`} onClick={() => chooseDate(date, time)}>{time}</button>)}</div></div>}
    </section>;
  };
  return <Card className="booking-calendar-card" title={<div className="booking-calendar-title"><span>{shopName} · 预约日历</span><small>门店当地时间 · {timezone}</small></div>}>
    <div className="booking-calendar-toolbar"><Space wrap><Button disabled={disabled} onClick={() => { if (!canInteract()) return; changeAnchor(today); setSelectedDate(undefined); }}>今天</Button><Button aria-label="上一范围" icon={<LeftOutlined />} disabled={disabled || !allowedAnchor(moveAnchor(anchor, view, -1))} onClick={() => changeAnchor(moveAnchor(anchor, view, -1))} /><Input aria-label="日历日期" type="date" min={minAnchor} max={maxAnchor} value={anchor} disabled={disabled} onChange={event => changeAnchor(event.target.value)} /><Button aria-label="下一范围" icon={<RightOutlined />} disabled={disabled || !allowedAnchor(moveAnchor(anchor, view, 1))} onClick={() => changeAnchor(moveAnchor(anchor, view, 1))} /></Space>
      <Space wrap><Select aria-label="日历视图" value={view} disabled={disabled} options={viewOptions} onChange={setMode} /><Button icon={<ReloadOutlined />} disabled={disabled} loading={state.loading} onClick={() => { if (canInteract()) void model.refresh(); }}>重载范围</Button></Space>
    </div>
    <div className="booking-calendar-filters"><Select aria-label="日历预约状态" placeholder="全部预约状态" allowClear disabled={disabled} value={status} onChange={value => { if (canInteract()) setStatus(value); }} options={statusOptions} />
      <Select aria-label="日历资源筛选" placeholder="全部技师／场地" allowClear disabled={disabled || state.loading} value={resourceKey} onChange={value => { if (canInteract()) setResourceKey(value); }} options={resources.map(resource => ({ value: `${resource.type}:${resource.id}`, label: `${resource.type === 'THERAPIST' ? '技师' : '场地'} · ${resource.name}` }))} />
      {(view === 'week' || view === 'day') && <Select aria-label="日历分列方式" value={groupBy} disabled={disabled} onChange={value => { if (canInteract()) setGroupBy(value); }} options={[{ value: 'TIME', label: '按日期／时间' }, { value: 'THERAPIST', label: '按技师分列' }, { value: 'ROOM', label: '按场地分列' }]} />}
    </div>
    <div className="booking-calendar-range">{range.startDate} — {addDays(range.endDate, -1)}{data && <><Tag>{bookingCount(events)} 笔预约</Tag><span>{events.length} 个事件 · 范围已完整加载</span></>}</div>
    {state.error && <Alert type="error" showIcon title="日历数据未完整" description={state.error} action={<Button onClick={() => void model.refresh()} disabled={disabled}>重新加载</Button>} />}
    {timezoneChanged && <Alert type="warning" showIcon title="门店时区已变化，日历暂未显示。" description="当前门店资料与事件接口的时区不一致。请刷新页面重新取得门店资料后再查看；不会按旧时区显示事件。" />}
    {state.loading && <div className="booking-calendar-loading" role="status"><Spin /><span>正在读取全部范围事件，数据尚未完整…</span></div>}
    {data && <>
      <p className="booking-calendar-note">数量按订单去重；服务段、技师和场地占用可能分列显示。选择日期可打开操作面板，空白不代表可预约，新增或改期仍需实时核对。</p>
      {view === 'month' ? <div className="booking-calendar-month-wrap"><div className="booking-calendar-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div><div className="booking-calendar-month">{days.map(date => { const items = onDate(date); return <section key={date} className={`booking-calendar-month-day${date.slice(0, 7) !== anchor.slice(0, 7) ? ' is-outside' : ''}${date === today ? ' is-today' : ''}${date === selectedDate ? ' is-selected' : ''}`}><button type="button" className="booking-calendar-month-date" disabled={disabled} onClick={() => chooseDate(date)} aria-current={date === today ? 'date' : undefined} aria-pressed={date === selectedDate} aria-label={`${dateLabel(date)}，${bookingCount(items)}笔预约`}><strong>{Number(date.slice(8))}</strong><small>{bookingCount(items)} 笔</small></button><div className="booking-calendar-month-events">{items.slice(0, 3).map(event => eventCard(event, undefined, true, date))}{items.length > 3 && <Button size="small" type="link" disabled={disabled} onClick={() => chooseDate(date)}>查看全部 {items.length} 个事件</Button>}</div></section>; })}</div></div>
        : view === 'list' ? <div className="booking-calendar-agenda">{days.map(date => dayGroup(date, events))}</div>
        : groupBy === 'TIME' ? <div className={`booking-calendar-time-columns${view === 'day' ? ' booking-calendar-time-columns--day' : ''}`}>{days.map(date => dayGroup(date, events))}</div>
        : <div className="booking-calendar-resource-columns">{[...resources.filter(resource => resource.type === groupBy), undefined].map(resource => <section className="booking-calendar-resource-column" key={resource ? `${resource.type}:${resource.id}` : 'unassigned'}><h3>{resource?.name ?? '未分配／未知资源／全店事件'}</h3>{days.map(date => dayGroup(date, resourceEvents(resource), resource))}</section>)}</div>}
    </>}
    <Drawer rootClassName="booking-calendar-drawer" title={<div className="booking-calendar-drawer-title"><strong>日期与时段操作</strong><small>{selectedDate ?? (selectedBlock ? shopLocal(selectedBlock.startAt, timezone).slice(0, 10) : '恢复原日历操作')}{selectedTime ? ` ${selectedTime}` : ''} · 门店当地时间 {timezone}</small></div>}
      placement="right" size="min(640px, 100vw)" open={!!selectedDate || !!selectedBlock || actionLocked} forceRender destroyOnHidden={false} closable={false} keyboard={false} mask={{ closable: false }}>
      {/* Keep the recovery model mounted even while hidden. Only the panel's
          guarded close/discard path can close this drawer; unknown writes stay. */}
      <CalendarActionsPanel shopId={shopId} timezone={timezone} date={selectedDate} startTime={selectedTime} event={selectedBlock} disabled={parentDisabled || timezoneChanged} onAssisted={onAssisted} onChanged={() => { void model.refresh(); }} onClose={() => { setSelectedDate(undefined); setSelectedBlock(undefined); setSelectedTime(undefined); }} onLockChange={updateActionLock} />
      {data && selectedDate && <section className="booking-calendar-selection" aria-label="所选日期详情"><div className="booking-calendar-selection-title"><h3>当天已记录事件</h3><Space><Button disabled={disabled} onClick={() => { if (canInteract()) { setAnchor(selectedDate); setMode('day'); } }}>查看当天</Button></Space></div><p>日历空白不代表可预约，新增或改期时仍会实时核对可用时间。</p>{onDate(selectedDate).length ? <div className="booking-calendar-agenda">{onDate(selectedDate).map(event => eventCard(event, undefined, false, selectedDate))}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前完整范围内未记录此日事件" />}</section>}
      {data && selectedBlock && <section className="booking-calendar-selection" aria-label="非订单事件详情"><h3>{typeLabels[selectedBlock.eventType]}</h3><p>{selectedBlock.title} · {blockStatusLabels[selectedBlock.status] ?? displayLabel(selectedBlock.status)}</p><p>{shopLocal(selectedBlock.startAt, timezone).replace('T', ' ')} — {shopLocal(selectedBlock.endAt, timezone).replace('T', ' ')} · {timezone}</p><p>{resourceLabel(selectedBlock)}</p><p className="booking-calendar-note">这是资源／营业事件，不是顾客订单。修改请使用上方对应营业操作。</p></section>}
      {!data && (selectedDate || selectedBlock) && <Alert type="info" showIcon title="日历范围正在重新核对，暂不显示旧事件。" description="保留所选日期与原操作；范围完整读取后自动更新。" />}
    </Drawer>
  </Card>;
}
