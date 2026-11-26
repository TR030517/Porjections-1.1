import { displayLabel } from '../../utils/displayLabels';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Alert, Button, Card, Col, DatePicker, Empty, InputNumber, Row, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { type LedgerCsv, type TransactionItem } from '../../api/merchant';
import { currentShopAllows, useShopId } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import { createEarningsModel, type EarningsState } from './model';
import { financialTimestamp } from '../../utils/financialTime';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
function saveCsv({ blob, filename }: LedgerCsv) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export default function EarningsPage() {
  const { shopId, shop, loading, refreshing, error, retry, can } = useShopId();
  const actorId = useAuthStore(state => state.merchant?.id);
  const token = useAuthStore(state => state.token);
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={() => void retry()}>重新核对门店权限</Button>} />;
  if (loading || refreshing) return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  if (!shopId) return <Empty description="请选择已授权门店查看账本。" />;
  if (!actorId || !token || !can('FINANCE_READ')) return <Alert type="warning" showIcon title="当前账号没有本店财务报表权限。" />;
  // A shop change mounts empty state immediately, before any new response arrives.
  return <ShopEarnings key={`${actorId}:${shopId}`} actorId={actorId} shopId={shopId} shopName={shop?.name || shopId} />;
}

function ShopEarnings({ shopId, shopName, actorId }: { shopId: string; shopName: string; actorId: string }) {
  const model = useMemo(() => createEarningsModel(shopId, undefined, () => useAuthStore.getState().merchant?.id === actorId && currentShopAllows(shopId, 'FINANCE_READ')), [shopId, actorId]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => { void model.load(); return model.dispose; }, [model]);
  return <EarningsContent state={state} model={model} shopName={shopName} />;
}

export function EarningsContent({ state, model, shopName }: { state: EarningsState; model: ReturnType<typeof createEarningsModel>; shopName: string }) {
  const dashboard = state.dashboard.data;
  const annual = state.annual.data;
  const financeConfigured = dashboard?.ledgerConfigured === true;
  const ledgerMissing = dashboard?.ledgerConfigured === false;
  const columns = [
    { title: '登记时间（门店当地）', dataIndex: 'createdAt', render: (value: string) => dashboard ? financialTimestamp(value, dashboard.timezone) : '—', width: 250 },
    { title: '说明', dataIndex: 'description', width: 240 },
    { title: '类型', dataIndex: 'type', render: (value: string) => <Tag color={value === 'REFUND' ? 'red' : 'blue'}>{displayLabel(value)}</Tag> },
    { title: '金额（USD）', dataIndex: 'amount', render: money },
    { title: '费用（USD）', dataIndex: 'fee', render: money },
    { title: '净额（USD）', dataIndex: 'net', render: money },
    { title: '状态', dataIndex: 'status', render: (value: string) => <Tag>{displayLabel(value)}</Tag> },
  ];
  const metrics = dashboard ? [
    { title: '已结算收入', value: dashboard.overview.totalRevenue },
    { title: '平台费用', value: dashboard.overview.totalFees },
    { title: '净收入', value: dashboard.overview.netRevenue },
    { title: '账本余额', value: dashboard.balanceCents },
    { title: '待结算', value: dashboard.pendingCents },
  ] : [];
  return <div style={{ minWidth: 0, maxWidth: '100%' }}>
    <Typography.Title level={4} style={{ marginBottom: 4 }}>门店收益账本</Typography.Title>
    <Typography.Paragraph type="secondary">{shopName} · 累计已结算指标{dashboard ? ` · 门店时区 ${dashboard.timezone}` : ''}</Typography.Paragraph>
    <Alert type="info" showIcon title="账本仅供查看，尚未启用外部收款账户设置或提现申请。" style={{ marginBottom: 20 }} />
    {state.dashboard.error && <Alert type="error" showIcon title={state.dashboard.error} action={<Button onClick={() => void model.retryDashboard()}>重试</Button>} />}
    {ledgerMissing && <Alert style={{ marginBottom: 16 }} type="info" showIcon title="账本尚未配置" description="请联系平台配置本店账本。当前不显示金额、交易或年度报表，也不生成空白或零金额CSV。" action={<Button onClick={() => void model.retryDashboard()}>重新检查账本</Button>} />}
    {state.dashboard.loading ? <Spin /> : dashboard && <Row gutter={[12, 12]}>{metrics.map(metric => <Col xs={24} sm={12} lg={8} key={metric.title}><Card size="small"><Statistic title={metric.title} value={metric.value === null ? '未配置' : metric.value / 100} precision={metric.value === null ? undefined : 2} suffix={metric.value === null ? undefined : 'USD'} /></Card></Col>)}</Row>}

    <Card title="账本交易" style={{ marginTop: 20, minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Typography.Text>登记日期（门店当地）</Typography.Text>
        <DatePicker.RangePicker
          aria-label="按门店当地日期筛选交易登记日期"
          disabled={!financeConfigured}
          style={{ width: 260, maxWidth: '100%', minWidth: 0 }}
          onChange={dates => void model.setDates(dates?.[0]?.format('YYYY-MM-DD'), dates?.[1]?.format('YYYY-MM-DD'))}
        />
      </div>
      <Typography.Paragraph type="secondary">按服务器分页查询本店记录。结束日期包含当日全部时间，日期筛选仅影响本列表。</Typography.Paragraph>
      {state.transactions.error && <Alert type="error" showIcon title={state.transactions.error} action={<Button onClick={() => void model.retryTransactions()}>重试</Button>} style={{ marginBottom: 12 }} />}
      {financeConfigured ? <Table<TransactionItem>
        dataSource={state.transactions.data?.items || []} columns={columns} rowKey="id"
        loading={state.transactions.loading} scroll={{ x: 1100 }} size="small"
        locale={{ emptyText: <Empty description={state.transactions.error ? '交易记录加载失败。' : '该日期范围暂无交易。'} /> }}
        pagination={{
          current: state.query.page, pageSize: state.query.pageSize, total: state.transactions.data?.total || 0,
          showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100], showTotal: total => `${total}条记录`,
          responsive: true, showLessItems: true,
          onChange: (page, pageSize) => void model.setPage(page, pageSize),
        }}
      /> : <Typography.Paragraph type="secondary">{ledgerMissing ? '账本尚未配置，暂无法显示交易记录。' : '账本资料尚未可用，请先等待或重试账本检查。'}</Typography.Paragraph>}
    </Card>

    <Card title="年度账本CSV" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <label htmlFor="ledger-year">年份（门店当地）</label>
        <InputNumber id="ledger-year" disabled={!financeConfigured} min={2000} max={2100} precision={0} value={state.year} onChange={year => { if (year !== null) void model.setYear(year); }} />
        <Button icon={<DownloadOutlined />} loading={state.exporting} disabled={!financeConfigured || !annual || state.annual.loading || Boolean(state.annual.error)} onClick={() => void model.exportCsv(saveCsv)}>下载CSV</Button>
      </div>
      <Typography.Paragraph type="secondary">{shopName} · {state.year === null ? '等待核对门店当地年份' : `${state.year}年已完成账本记录`}。此账务导出不能代替报税申报或提现指令。</Typography.Paragraph>
      {!financeConfigured && <Typography.Paragraph type="secondary">{ledgerMissing ? '账本尚未配置，年度数据与CSV暂不可用。' : '请先完成账本检查后再查询或下载。'}</Typography.Paragraph>}
      {state.annual.error && <Alert type="error" showIcon title={state.annual.error} action={<Button onClick={() => void model.retryAnnual()}>重试</Button>} />}
      {state.exportError && <Alert type="error" showIcon title={state.exportError} style={{ marginBottom: 12 }} />}
      {state.annual.loading ? <Spin /> : annual && <Row gutter={[16, 12]}>
        <Col xs={12} md={6}><Statistic title="收款总额" value={annual.total_gross / 100} precision={2} suffix="USD" /></Col>
        <Col xs={12} md={6}><Statistic title="退款" value={annual.total_refunds / 100} precision={2} suffix="USD" /></Col>
        <Col xs={12} md={6}><Statistic title="平台费用" value={annual.total_platform_fees / 100} precision={2} suffix="USD" /></Col>
        <Col xs={12} md={6}><Statistic title="净收益" value={annual.net_earnings / 100} precision={2} suffix="USD" /></Col>
      </Row>}
    </Card>
  </div>;
}
