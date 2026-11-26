import { displayLabel } from '../../utils/displayLabels';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Input, Modal, Pagination, Select, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { caseOperation, caseStatuses, caseTypes, getCase, getCaseEvents, listCases, type AfterSalesCase, type CaseAction, type CaseEvent, type CasePage } from '../../api/afterSales';
import { isCurrentShop, useShopId } from '../../hooks/useShopId';
import BookingDetails, { bookingTime } from '../../components/BookingDetails';
import PageHeader from '../../components/PageHeader';
import { errorMessage, money } from '../../utils/feedback';

const labels: Record<CaseAction, string> = { CLAIM: '接手工单', NOTE: '添加备注', ACCEPT: '接受申请', WAIT_FOR_CUSTOMER: '等待顾客', RESUME: '继续处理', REJECT: '拒绝申请', RESOLVE: '解决工单', WITHDRAW: '撤回', REFUND: '执行退款', RECONCILE: '核对原退款' };
const reasons = ['WAIT_FOR_CUSTOMER', 'REJECT', 'RESOLVE'];

function refundStatus(item: AfterSalesCase) {
  if (item.type !== 'REFUND') return '—';
  if (item.refundMode !== 'PAY_AT_STORE') return item.refundState ? displayLabel(item.refundState) : '尚未开始';
  if (item.offlineRefundRecordedCents != null) return '线下退款已登记';
  if (item.booking?.paymentStatus === 'REFUNDED' || (item.booking?.refundedCents ?? 0) > 0) return '付款与退款记录待核实';
  return '线下退款未登记';
}
export default function AfterSalesPage() {
  const { shopId, loading: shopLoading } = useShopId();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<{ status?: string; type?: string; bookingId?: string; bookingNo?: string }>({ bookingId: params.get('bookingId') || undefined, bookingNo: params.get('bookingNo') || undefined });
  const [bookingSearch, setBookingSearch] = useState(params.get('bookingNo') || '');
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25), [reload, setReload] = useState(0);
  const [result, setResult] = useState<CasePage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [selected, setSelected] = useState<string>();
  useEffect(() => {
    const controller = new AbortController(); setError(''); setResult(null);
    if (!shopId) { setLoading(false); return; }
    setLoading(true); listCases(shopId, { ...filters, page, pageSize }, controller.signal).then(data => { if (!controller.signal.aborted) setResult(data); }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [shopId, filters, page, pageSize, reload]);
  const filter = (values: typeof filters) => { setFilters(values); setPage(1); };
  const searchBooking = () => {
    const bookingNo = bookingSearch.trim() || undefined;
    if (bookingNo && (bookingNo.length > 30 || /[\u0000-\u001f\u007f]/.test(bookingNo))) { setError('请填写30个字符以内的完整预约编号。'); return; }
    const { bookingId: _legacyId, ...otherFilters } = filters;
    filter({ ...otherFilters, bookingNo });
    const next = new URLSearchParams(params); next.delete('bookingId');
    if (bookingNo) next.set('bookingNo', bookingNo); else next.delete('bookingNo');
    setParams(next);
  };
  const resetFilters = () => {
    setBookingSearch(''); filter({});
    const next = new URLSearchParams(params);
    for (const key of ['bookingId', 'bookingNo', 'status', 'type']) next.delete(key);
    setParams(next);
  };
  return <div className="merchant-page"><PageHeader title="售后管理" description="跟进顾客提交的工单，核对处理进度和退款状态。" actions={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => setReload(v => v + 1)}>刷新</Button>} />
    <Alert showIcon type="info" title="工单提交与处理" description={<>
      <div>请顾客登录后在对应预约中提交售后申请。电话或到店反馈若无法通过顾客账号提交，请先线下留档。</div>
      <div>改期和到店付款退款请打开预约详情。历史线上付款请在对应退款工单中核对原渠道退款。</div>
    </>} />
    <Card><div className="merchant-filter-bar"><Select aria-label="工单状态" allowClear placeholder="全部状态" value={filters.status} onChange={status => filter({ ...filters, status })} options={caseStatuses.map(value => ({ value, label: displayLabel(value) }))} /><Select aria-label="工单类型" allowClear placeholder="全部类型" value={filters.type} onChange={type => filter({ ...filters, type })} options={caseTypes.map(value => ({ value, label: displayLabel(value) }))} /><Input.Search aria-label="预约编号" value={bookingSearch} allowClear placeholder="完整预约编号" onChange={event => setBookingSearch(event.target.value)} onSearch={searchBooking} /><Button onClick={resetFilters}>重置筛选</Button>{filters.bookingId && <Tag>内部预约ID #{filters.bookingId}</Tag>}</div></Card>
    {error && <Alert type="error" showIcon title={error} />}
    {!shopId && !shopLoading ? <Empty description="请选择已授权门店。" /> : <Table<AfterSalesCase> rowKey="id" dataSource={result?.items ?? []} loading={loading || shopLoading} scroll={{ x: 1100 }} pagination={{ current: page, pageSize, total: result?.total ?? 0, showSizeChanger: true, pageSizeOptions: [25, 50, 100], showTotal: total => `${total}个工单`, onChange: (p, size) => { setPage(size !== pageSize ? 1 : p); setPageSize(size); } }} columns={[
      { title: '工单', dataIndex: 'id', render: value => <Button type="link" onClick={() => setSelected(value)}>#{value}</Button> }, { title: '类型', dataIndex: 'type', render: value => displayLabel(value) },
      { title: '预约', render: (_, row) => row.booking?.bookingNo || `#${row.bookingId}` }, { title: '状态', render: (_, row) => <Tag>{displayLabel(row.status)}</Tag> },
      { title: '申请退款', render: (_, row) => row.type === 'REFUND' ? money(row.requestedAmountCents, row.currency) : '—' }, { title: '退款状态', render: (_, row) => refundStatus(row) },
      { title: '更新时间', render: (_, row) => new Date(row.updatedAt).toLocaleString('zh-CN') }, { title: '操作', render: (_, row) => <Button onClick={() => setSelected(row.id)}>处理工单</Button> },
    ]} />}
    {selected && shopId && <CaseDetails id={selected} shopId={shopId} onClose={() => setSelected(undefined)} onUpdated={() => setReload(value => value + 1)} />}
  </div>;
}

function CaseDetails({ id, shopId, onClose, onUpdated }: { id: string; shopId: string; onClose: () => void; onUpdated: () => void }) {
  const [detail, setDetail] = useState<AfterSalesCase | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [note, setNote] = useState(''), [visibility, setVisibility] = useState<'PUBLIC' | 'INTERNAL'>('INTERNAL'), [action, setAction] = useState<CaseAction | null>(null), [reason, setReason] = useState('');
  const [eventPage, setEventPage] = useState(1), [events, setEvents] = useState<{ items: CaseEvent[]; total: number } | null>(null), [eventError, setEventError] = useState(''), [eventsLoading, setEventsLoading] = useState(false), [bookingOpen, setBookingOpen] = useState(false);
  const mounted = useRef(true), [modal, modalContext] = Modal.useModal();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && isCurrentShop(shopId);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getCase(id, shopId, controller.signal).then(row => { if (!controller.signal.aborted) setDetail(row); }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, shopId, reload]);
  useEffect(() => {
    const controller = new AbortController(); setEvents(null); setEventError(''); setEventsLoading(true);
    getCaseEvents(id, eventPage, controller.signal).then(value => { if (!controller.signal.aborted) setEvents(value); }).catch(e => { if (!controller.signal.aborted) setEventError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setEventsLoading(false); });
    return () => controller.abort();
  }, [id, eventPage, reload]);
  const dirty = Boolean(note.trim() || reason.trim());
  const close = async () => { if (busy) return; if (dirty && !await modal.confirm({ title: '放弃尚未发送的工单内容？', okText: '放弃', cancelText: '继续编辑' })) return; onClose(); };
  const run = async (operation: 'claim' | 'notes' | 'transition' | 'refund' | 'reconcile', payload: Record<string, unknown>) => {
    if (!detail || busy || !current()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const row = await caseOperation(id, shopId, operation, { ...payload, version: detail.version });
      if (!current()) return;
      setDetail(row);
      if (operation === 'notes') setNote('');
      if (operation === 'transition') { setReason(''); setAction(null); }
      setEventPage(1); setReload(v => v + 1); onUpdated(); setNotice(operation === 'reconcile' ? '已核对原退款记录。处理中或未知结果仍保留等待核实，未创建替代退款。' : operation === 'refund' ? '退款请求已处理。请核对下方记录的退款状态，处理中不代表退款完成。' : '工单已保存。');
    } catch (e) {
      if (!current()) return;
      const conflict = (e as { response?: { status?: number } }).response?.status === 409;
      setError(conflict ? '工单已变化或不再满足操作条件。已刷新最新记录，请核对后再尝试。' + errorMessage(e) : errorMessage(e));
      if (conflict) {
        try { const row = await getCase(id, shopId); if (current()) { setDetail(row); setAction(null); setReason(''); onUpdated(); } } catch { if (current()) setDetail(null); }
      }
    } finally { if (current()) setBusy(false); }
  };
  const perform = async (value: CaseAction) => {
    if (!detail) return;
    if (value === 'REFUND') {
      if (await modal.confirm({ title: ['PENDING', 'RETRYABLE'].includes(detail.refundState || '') ? '重试同一笔退款请求？' : '执行已接受的退款申请？', content: `${money(detail.requestedAmountCents, detail.currency)}。服务器将保留原请求键和金额；重试不会创建另一笔退款。`, okText: '执行退款', okButtonProps: { danger: true } }) && current()) await run('refund', {});
    } else if (value === 'RECONCILE') await run('reconcile', {});
    else if (value === 'CLAIM') await run('claim', {});
    else { setAction(value); setReason(''); }
  };
  const allowed = detail?.allowedActions ?? [];
  const offlineRefund = detail?.type === 'REFUND' && detail.refundMode === 'PAY_AT_STORE';
  const activeCase = detail && !['RESOLVED', 'REJECTED', 'WITHDRAWN'].includes(detail.status);
  return <Modal open title={`售后工单编号 #${id}`} width={900} footer={null} onCancel={() => void close()} maskClosable={false} closable={!busy} destroyOnHidden>{modalContext}<div className="merchant-modal-stack">
    {error && <Alert type="error" showIcon title={error} />}{notice && <Alert type="success" showIcon title={notice} />}
    <Space wrap><Button loading={loading} disabled={busy || dirty} onClick={() => setReload(v => v + 1)}>刷新工单</Button>{detail && <Button disabled={busy || dirty} onClick={() => setBookingOpen(true)}>{offlineRefund ? '预约详情与退款登记' : '预约详情与改期'}</Button>}</Space>
    {loading ? <Card loading /> : detail && <>
      <Space wrap><Tag>{displayLabel(detail.type)}</Tag><Tag>{displayLabel(detail.status)}</Tag><Typography.Text type="secondary">版本 {detail.version}{detail.assignedToId ? ` · 处理人编号 #${detail.assignedToId}` : ' · 未分配'}</Typography.Text></Space>
      <Descriptions column={{ xs: 1, sm: 2 }} items={[
        { key: 'booking', label: '预约', children: detail.booking?.bookingNo || `#${detail.bookingId}` }, { key: 'service', label: '服务', children: detail.booking?.serviceName || '—' },
        { key: 'time', label: '预约时间', children: detail.booking ? bookingTime(detail.booking) : '—', span: 2 },
        { key: 'request', label: '申请退款', children: detail.type === 'REFUND' ? money(detail.requestedAmountCents, detail.currency) : '非退款申请' }, { key: 'state', label: '退款执行', children: refundStatus(detail) },
        { key: 'paid', label: '实际已付', children: money(detail.booking?.paidCents, detail.booking?.currency) }, { key: 'refunded', label: '实际已退', children: money(detail.booking?.refundedCents, detail.booking?.currency) },
      ]} />
      <section className="merchant-inset"><strong>顾客申请</strong><p className="merchant-wrap">{detail.reason}</p></section>
      {offlineRefund && (detail.offlineRefundRecordedCents != null || activeCase) && (
        <Alert
          showIcon
          type="info"
          title="到店付款退款"
          description={detail.offlineRefundRecordedCents != null
            ? `实际登记金额 ${money(detail.offlineRefundRecordedCents, detail.currency)}。请核对金额和工单状态。`
            : detail.booking?.paymentStatus === 'REFUNDED' || (detail.booking?.refundedCents ?? 0) > 0
              ? '请到预约详情核对付款和退款凭证。'
              : '请先完成实际退款，再到预约详情登记退款。登记后返回工单核对金额。'}
        />
      )}
      {detail.type === 'RESCHEDULE' && <Alert showIcon type="info" title="处理改期工单不会改变预约时间" description="请打开预约详情与改期，核对资源并保存新时间后，在此记录处理结果。" />}
      <Space wrap>{allowed.filter(value => value !== 'NOTE' && value !== 'WITHDRAW').map(value => <Button key={value} disabled={busy} danger={value === 'REFUND' || value === 'REJECT'} type={value === 'ACCEPT' ? 'primary' : 'default'} onClick={() => void perform(value)}>{value === 'REFUND' && ['PENDING', 'RETRYABLE'].includes(detail.refundState || '') ? '重试同一笔退款' : labels[value]}</Button>)}</Space>
      {!allowed.length && <Typography.Paragraph type="secondary">当前工单与账号暂无可用处理操作。</Typography.Paragraph>}
      {action && <section className="merchant-inset"><Typography.Title level={5}>{labels[action]}</Typography.Title>{reasons.includes(action) ? <><Typography.Paragraph type="secondary">该说明将对顾客可见。</Typography.Paragraph><Input.TextArea rows={3} maxLength={2000} showCount value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></> : <Typography.Paragraph>确认变更工单状态？此操作不改变预约资源或转移资金。</Typography.Paragraph>}<Space style={{ marginTop: 16 }}><Button type="primary" loading={busy} disabled={reasons.includes(action) && !reason.trim()} onClick={() => void run('transition', { action, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>保存变更</Button><Button disabled={busy} onClick={() => { setAction(null); setReason(''); }}>返回</Button></Space></section>}
      {allowed.includes('NOTE') && <section><Typography.Title level={5}>添加工单备注</Typography.Title><Select aria-label="备注可见范围" value={visibility} disabled={busy} onChange={setVisibility} options={[{ value: 'INTERNAL', label: '内部·仅操作人员' }, { value: 'PUBLIC', label: '公开·顾客可读' }]} style={{ width: '100%', marginBottom: 12 }} /><Input.TextArea rows={3} maxLength={2000} showCount value={note} disabled={busy} onChange={event => setNote(event.target.value)} /><Button style={{ marginTop: 12 }} type="primary" loading={busy} disabled={!note.trim()} onClick={() => void run('notes', { content: note.trim(), visibility })}>发送 {visibility === 'PUBLIC' ? '公开回复' : '内部备注'}</Button></section>}
      <section><Typography.Title level={5}>工单处理记录</Typography.Title>{eventError && <Alert type="error" title={eventError} showIcon />}{eventsLoading ? <Card loading /> : <div className="merchant-resource-list">{(events?.items ?? []).map(event => <article className="merchant-resource-row" key={event.id}><div><Space wrap><strong>{displayLabel(event.kind, '处理记录')}</strong><Tag>{displayLabel(event.visibility)}</Tag><Typography.Text type="secondary">{displayLabel(event.actorRole)} · {new Date(event.createdAt).toLocaleString('zh-CN')}</Typography.Text></Space>{event.toStatus && <p>{displayLabel(event.fromStatus)} → {displayLabel(event.toStatus)}</p>}{event.content && <p className="merchant-wrap">{event.content}</p>}</div></article>)}{events?.items.length === 0 && <Empty description="暂无处理记录" />}</div>}<Pagination style={{ marginTop: 16 }} current={eventPage} pageSize={25} total={events?.total ?? 0} showSizeChanger={false} onChange={setEventPage} /></section>
    </>}
    {bookingOpen && detail && <BookingDetails id={detail.bookingId} shopId={shopId} onClose={() => setBookingOpen(false)} onUpdated={() => { setReload(v => v + 1); onUpdated(); }} />}
  </div></Modal>;
}
