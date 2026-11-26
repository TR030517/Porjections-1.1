import { displayLabel } from '../../utils/displayLabels';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal, Pagination, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getEntitlements, getGiftConfig, getGiftProducts, getRedemptions, grantGift, redeemGift, voidGift, type Entitlement, type GiftConfig, type GiftPage, type GiftProduct, type Redemption } from '../../api/gifts';
import { isCurrentShop, useShopId } from '../../hooks/useShopId';
import PageHeader from '../../components/PageHeader';
import { errorMessage, money } from '../../utils/feedback';
import GiftOrdersPanel from './GiftOrdersPanel';
import { giftTimestamp } from '../../utils/giftTime';

const states = ['ACTIVE', 'EXHAUSTED', 'EXPIRED', 'VOIDED'];
type Filters = { userId?: string; entitlementId?: string; status?: string };
export default function GiftsPage() {
  const { shopId, loading: shopLoading } = useShopId();
  const [config, setConfig] = useState<GiftConfig | null>(null), [configError, setConfigError] = useState(''), [tab, setTab] = useState('entitlements');
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25), [reload, setReload] = useState(0), [filters, setFilters] = useState<Filters>({});
  const [filterForm] = Form.useForm<Filters>();
  const [entitlements, setEntitlements] = useState<GiftPage<Entitlement> | null>(null), [redemptions, setRedemptions] = useState<GiftPage<Redemption> | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [redeeming, setRedeeming] = useState(false), [voiding, setVoiding] = useState<Entitlement | null>(null), [voidReason, setVoidReason] = useState(''), [busy, setBusy] = useState(false), [voidError, setVoidError] = useState('');
  const [modal, modalContext] = Modal.useModal(), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && !!shopId && isCurrentShop(shopId);
  useEffect(() => {
    const controller = new AbortController(); setConfigError('');
    getGiftConfig(controller.signal).then(value => { if (!controller.signal.aborted) setConfig(value); }).catch(e => { if (!controller.signal.aborted) setConfigError(errorMessage(e)); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setEntitlements(null); setRedemptions(null);
    if (!shopId || tab === 'grant' || tab === 'orders') { setLoading(false); return; }
    setLoading(true);
    const request = tab === 'redemptions' ? getRedemptions(shopId, { page, pageSize, userId: filters.userId, entitlementId: filters.entitlementId }, controller.signal).then(value => { if (!controller.signal.aborted) setRedemptions(value); }) : getEntitlements(shopId, { page, pageSize, ...filters }, controller.signal).then(value => { if (!controller.signal.aborted) setEntitlements(value); });
    request.catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [shopId, tab, page, pageSize, filters, reload]);
  const onSaved = (message: string) => { if (current()) { setNotice(message); setReload(v => v + 1); } };
  const pagination = (total: number) => ({ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [25, 50, 100], onChange: (p: number, size: number) => { setPage(size !== pageSize ? 1 : p); setPageSize(size); }, showTotal: (value: number) => `${value}条记录` });
  return <div className="merchant-page">{modalContext}<PageHeader title="礼品订单与权益" description="本店到店付销售、促销赠送与经顾客确认的次数核销。" actions={<Space wrap><Button icon={<ReloadOutlined />} loading={loading} disabled={busy || redeeming || !!voiding} onClick={() => setReload(v => v + 1)}>刷新</Button><Button type="primary" disabled={busy} onClick={() => setRedeeming(true)}>核销顾客凭证</Button></Space>} />
    <Alert type="info" showIcon title={config?.onlinePaymentEnabled === false ? '线上礼品卡付款未启用' : '正在核对礼品付款能力'} description={`${config?.reason || '到店付销售须由本店明确开启，目前不支持线上扣款。'}促销赠送不会登记收入或付款。`} />
    {configError && <Alert type="error" showIcon title={configError} />}{error && <Alert type="error" showIcon title={error} />}{notice && <Alert type="success" showIcon title={notice} closable onClose={() => setNotice('')} />}
    {!shopId && !shopLoading ? <Empty description="请选择已授权门店。" /> : shopId && <Tabs activeKey={tab} onChange={value => { setTab(value); setPage(1); }} items={[
      { key: 'orders', disabled: busy, label: '购买订单与销售规则' }, { key: 'entitlements', disabled: busy, label: '顾客权益' }, { key: 'redemptions', disabled: busy, label: '核销记录' }, { key: 'grant', disabled: busy, label: '促销赠送' },
    ]} />}
    {shopId && (tab === 'entitlements' || tab === 'redemptions') && <><Card><Form form={filterForm} layout="inline" className="merchant-inline-form" onFinish={values => { setFilters({ userId: values.userId?.trim() || undefined, entitlementId: values.entitlementId?.trim() || undefined, status: values.status }); setPage(1); }}><Form.Item name="userId" rules={[{ pattern: /^[1-9]\d*$/, message: '请填写正整数顾客编号。' }]}><Input aria-label="顾客编号" placeholder="完整顾客编号" allowClear /></Form.Item><Form.Item name="entitlementId"><Input aria-label="权益编号" placeholder="完整权益编号" allowClear /></Form.Item>{tab === 'entitlements' && <Form.Item name="status"><Select aria-label="权益状态" placeholder="全部状态" allowClear options={states.map(value => ({ value, label: displayLabel(value) }))} /></Form.Item>}<Form.Item><Space><Button htmlType="submit" type="primary">应用</Button><Button onClick={() => { filterForm.resetFields(); setFilters({}); setPage(1); }}>重置</Button></Space></Form.Item></Form></Card>
      {tab === 'entitlements' ? <Table<Entitlement> rowKey="id" loading={loading} dataSource={entitlements?.items ?? []} pagination={pagination(entitlements?.total ?? 0)} scroll={{ x: 1200 }} columns={[
        { title: '权益／产品', render: (_, row) => <div><strong>{row.productTitleSnapshot}</strong><p className="merchant-secondary merchant-id">{row.id}</p></div> },
        { title: '顾客', dataIndex: 'userId' }, { title: '来源', dataIndex: 'source', render: value => <Tag>{displayLabel(value)}</Tag> },
        { title: '剩余次数', render: (_, row) => `${row.remainingUses} / ${row.totalUses}` }, { title: '到期时间（门店）', render: (_, row) => row.expiresAt ? giftTimestamp(row.expiresAt, row.timezone) : '永久有效' }, { title: '状态', dataIndex: 'status', render: value => <Tag>{displayLabel(value)}</Tag> },
        { title: '操作', render: (_, row) => <Space wrap><Button onClick={() => { filterForm.setFieldsValue({ entitlementId: row.id }); setFilters({ entitlementId: row.id }); setTab('redemptions'); setPage(1); }}>使用记录</Button>{row.source === 'PROMOTIONAL' && !row.orderId && row.remainingUses === row.totalUses && row.status !== 'VOIDED' && <Button danger onClick={() => { setVoiding(row); setVoidReason(''); setVoidError(''); }}>作废未使用赠送权益</Button>}</Space> },
      ]} /> : <Table<Redemption> rowKey="id" loading={loading} dataSource={redemptions?.items ?? []} pagination={pagination(redemptions?.total ?? 0)} scroll={{ x: 1000 }} columns={[
        { title: '核销', dataIndex: 'id', className: 'merchant-id' }, { title: '权益', dataIndex: 'entitlementId', className: 'merchant-id' }, { title: '扣除次数', dataIndex: 'usedUses' }, { title: '操作人', dataIndex: 'operatorId' }, { title: '登记时间（门店）', render: (_, row) => giftTimestamp(row.createdAt, row.timezone) },
      ]} />}</>}
    {shopId && tab === 'orders' && <GiftOrdersPanel key={'orders:' + shopId} shopId={shopId} onBusyChange={setBusy} />}
    {shopId && tab === 'grant' && <GrantPanel shopId={shopId} enabled={config?.promotionalEntitlementsEnabled === true} onSaved={onSaved} />}
    {shopId && redeeming && <RedeemDialog shopId={shopId} ttl={config?.credentialTtlSeconds ?? 300} onClose={() => setRedeeming(false)} onSaved={onSaved} />}
    <Modal open={!!voiding} title="作废未使用的促销赠送" okText="作废权益" okButtonProps={{ danger: true, disabled: !voidReason.trim() }} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={false} onCancel={() => { if (!busy) setVoiding(null); }} onOk={async () => {
      if (!shopId || !voiding || !voidReason.trim() || busy) return;
      if (!await modal.confirm({ title: '永久作废该未使用的促销赠送权益？', content: '此操作将撤销剩余使用次数，不会退款。', okText: '作废权益', okButtonProps: { danger: true } })) return;
      if (!current()) return;
      setBusy(true); setVoidError('');
      try { await voidGift(shopId, voiding.id, voidReason.trim()); if (current()) { setVoiding(null); onSaved('促销权益已作废，未进行退款。'); } } catch (e) { if (current()) setVoidError(errorMessage(e)); } finally { if (current()) setBusy(false); }
    }}><div className="merchant-modal-stack">{voidError && <Alert type="error" showIcon title={voidError} />}<Typography.Paragraph>{voiding?.productTitleSnapshot} · 顾客编号 #{voiding?.userId}</Typography.Paragraph><Input.TextArea aria-label="作废原因" value={voidReason} onChange={event => setVoidReason(event.target.value)} maxLength={500} rows={3} placeholder="请填写原因" disabled={busy} /></div></Modal>
  </div>;
}

function GrantPanel({ shopId, enabled, onSaved }: { shopId: string; enabled: boolean; onSaved: (message: string) => void }) {
  const [products, setProducts] = useState<GiftPage<GiftProduct> | null>(null), [page, setPage] = useState(1), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false), [selected, setSelected] = useState<GiftProduct | null>(null);
  const [form] = Form.useForm<{ userId: string; reason: string }>(), request = useRef<{ fingerprint: string; key: string } | null>(null), mounted = useRef(true), [modal, modalContext] = Modal.useModal();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && isCurrentShop(shopId);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setProducts(null); setError(''); getGiftProducts(shopId, page, controller.signal).then(value => { if (!controller.signal.aborted) setProducts(value); }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [shopId, page]);
  return <div className="merchant-page">{modalContext}<Card title="请选择已启用的礼品产品"><Typography.Paragraph type="secondary">仅可选择已发布门店的启用产品。产品配置仍由平台管理；选择产品不会销售或登记收入。</Typography.Paragraph>{error && <Alert type="error" showIcon title={error} />}<Table<GiftProduct> rowKey="id" loading={loading} dataSource={products?.items ?? []} scroll={{ x: 700 }} pagination={false} rowSelection={{ type: 'radio', selectedRowKeys: selected ? [selected.id] : [], onChange: (_, rows) => { setSelected(rows[0] ?? null); request.current = null; }, getCheckboxProps: () => ({ disabled: busy || !enabled }) }} columns={[{ title: '产品', dataIndex: 'title' }, { title: '包含次数', dataIndex: 'useTimes' }, { title: '有效期', render: (_, row) => `${row.expireDays}天（赠送后）` }, { title: '目录价格·不收取', render: (_, row) => money(row.priceCents, row.currency) }]} /><Pagination style={{ marginTop: 16 }} current={page} pageSize={25} total={products?.total ?? 0} showSizeChanger={false} disabled={busy} onChange={setPage} /></Card>
    <Card title="赠送促销权益">{!enabled && <Alert type="warning" title="配置完成加载并启用前，不可赠送促销权益。" showIcon />}{selected && <Descriptions column={1} items={[{ key: 'selection', label: '所选产品', children: `${selected.title} · ${selected.useTimes}次 · 发放后${selected.expireDays}天` }]} />}<Form form={form} layout="vertical" disabled={busy || !enabled} onValuesChange={() => { request.current = null; }} onFinish={async values => {
      if (!selected || busy || !current()) return;
      const payload = { productId: selected.id, userId: values.userId.trim(), reason: values.reason.trim() };
      if (!await modal.confirm({ title: '免费赠送该权益？', content: `${selected.title} · ${selected.useTimes}次，赠送给顾客编号 #${payload.userId}。这是促销赠送，不是付费销售。`, okText: '赠送促销权益' })) return;
      if (!current()) return;
      const fingerprint = JSON.stringify(payload); if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
      setBusy(true); setError('');
      try { const item = await grantGift(shopId, { ...payload, requestKey: request.current.key }); if (current()) { form.resetFields(); request.current = null; onSaved(`促销权益已赠送：${item.id}。未登记付款或收入。`); } }
      catch (e) { if (current()) setError(errorMessage(e) + '保持原请求不变重试时，会继续使用同一请求键。'); } finally { if (current()) setBusy(false); }
    }}><Form.Item name="userId" label="顾客编号" rules={[{ required: true, pattern: /^[1-9]\d*$/, message: '请输入已有顾客的数字编号。' }]}><Input maxLength={20} placeholder="已有顾客编号" /></Form.Item><Form.Item name="reason" label="赠送原因" rules={[{ required: true, whitespace: true, max: 500 }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item><Button type="primary" htmlType="submit" disabled={!selected || !enabled} loading={busy}>免费赠送</Button></Form></Card>
  </div>;
}

function RedeemDialog({ shopId, ttl, onClose, onSaved }: { shopId: string; ttl: number; onClose: () => void; onSaved: (message: string) => void }) {
  const [form] = Form.useForm<{ token: string; usedUses: number }>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [modal, modalContext] = Modal.useModal();
  const request = useRef<{ token: string; usedUses: number; key: string } | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current = null; }; }, []);
  const current = () => mounted.current && isCurrentShop(shopId);
  return <Modal open title="核销顾客出示的凭证" footer={null} maskClosable={false} closable={!busy} onCancel={() => { if (!busy) onClose(); }} width={620}>{modalContext}<div className="merchant-modal-stack"><Alert type="info" showIcon title="请顾客生成核销凭证" description={`顾客在客户端选择准确使用次数后，请将凭证粘贴至此并输入相同次数。凭证约在${Math.ceil(ttl / 60)}分钟后过期，仅可使用一次；凭证只保留在当前页面内存中。`} />{error && <Alert type="error" showIcon title={error} />}<Form form={form} layout="vertical" disabled={busy} onValuesChange={() => { request.current = null; }} onFinish={async values => {
    if (busy || !current()) return;
    const token = values.token.trim(), usedUses = values.usedUses;
    if (!await modal.confirm({ title: `扣除${usedUses}次顾客权益使用次数？`, content: '此操作会立即登记核销，不收款或退款。', okText: '确认核销' })) return;
    if (!current()) return;
    if (request.current?.token !== token || request.current.usedUses !== usedUses) request.current = { token, usedUses, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try { const result = await redeemGift(shopId, { token, usedUses, requestKey: request.current.key }); if (current()) { form.resetFields(); request.current = null; onSaved(`${result.replayed ? '已确认原核销记录' : '核销已登记'}: ${result.item.usedUses}次${result.remainingUses == null ? '' : ` · ${result.remainingUses}次剩余`}.`); onClose(); } }
    catch (e) { if (current()) setError(errorMessage(e) + '保持原请求不变重试时会使用同一请求键；修改前请核对使用记录。'); } finally { if (current()) setBusy(false); }
  }}><Form.Item name="token" label="顾客凭证" rules={[{ required: true, whitespace: true, max: 100 }]}><Input.TextArea autoComplete="off" rows={4} spellCheck={false} maxLength={100} placeholder="粘贴顾客提供的gc1_…凭证" /></Form.Item><Form.Item name="usedUses" label="顾客批准的准确次数" rules={[{ required: true, type: 'integer', min: 1, max: 10000 }]}><InputNumber min={1} max={10000} precision={0} /></Form.Item><Button type="primary" htmlType="submit" loading={busy}>核对并核销</Button></Form></div></Modal>;
}
