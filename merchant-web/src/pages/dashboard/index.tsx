import { displayLabel } from '../../utils/displayLabels';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  Card,
  Col,
  Row,
  Statistic,
  Table,
  Tag,
  Typography,
  Spin,
  Empty,
  Rate,
  Alert,
  Button,
  Space,
} from 'antd';
import {
  DollarOutlined,
  CalendarOutlined,
  WalletOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { financialTimestamp } from '../../utils/financialTime';
import { Link } from 'react-router-dom';
import { currentShopAllows, useShopId } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import type { ShopPermission } from '../../utils/shopPermissions';
import { createDashboardModel } from './model';
import type { DashboardData } from '../../api/merchant';

const { Title } = Typography;

const statusColor: Record<string, string> = {
  CONFIRMED: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'red',
  PENDING: 'orange',
  REFUNDING: 'purple',
  REFUNDED: 'magenta',
};

const txStatusColor: Record<string, string> = {
  COMPLETED: 'green',
  PENDING: 'orange',
  FAILED: 'red',
};

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function DashboardPage() {
  const { shopId, loading, refreshing, error, can, retry } = useShopId();
  const actorId = useAuthStore(state => state.merchant?.id);
  const token = useAuthStore(state => state.token);
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={() => void retry()}>重新核对门店权限</Button>} />;
  // Do not keep a prior shop's or stale permission scope's financial view mounted.
  if (loading || refreshing) return <div style={{ textAlign: 'center', paddingTop: 120 }}><Spin size="large" /></div>;
  if (!shopId) return <Empty description="请选择已授权门店查看经营概览。" />;
  if (!actorId || !token || !can('FINANCE_READ')) return <Alert type="warning" showIcon title="当前账号没有本店经营概览权限。" />;
  return <ShopDashboard key={`${actorId}:${shopId}`} shopId={shopId} actorId={actorId} can={can} />;
}

function ShopDashboard({ shopId, actorId, can }: { shopId: string; actorId: string; can: (permission: ShopPermission | 'OWNER_ONLY') => boolean }) {
  const model = useMemo(() => createDashboardModel(shopId, () => useAuthStore.getState().merchant?.id === actorId && currentShopAllows(shopId, 'FINANCE_READ')), [shopId, actorId]);
  const { data, loading, error } = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => { void model.load(); return model.dispose; }, [model]);
  if (loading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 120 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={() => void model.load()}>重试经营概览</Button>} />;

  if (!data) {
    return <Empty description="经营概览加载失败" />;
  }

  return <DashboardContent data={data} shopId={shopId} can={can} />;
}

export function DashboardContent({ data, shopId, can }: { data: DashboardData; shopId: string; can: (permission: ShopPermission | 'OWNER_ONLY') => boolean }) {
  const overview = data.overview;
  const finance = data.ledgerConfigured ? data : null;
  const selected = (route: string) => `${route}?shopId=${encodeURIComponent(shopId)}`;

  const txColumns = [
    {
      title: '日期',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => financialTimestamp(v, data.timezone),
    },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (t: string) => <Tag color={t === 'PAYOUT' ? 'purple' : t === 'REFUND' ? 'red' : 'blue'}>{displayLabel(t)}</Tag>,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right' as const,
      render: (v: number) => <span style={{ color: v < 0 ? '#ff4d4f' : '#52c41a' }}>{fmtMoney(v)}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={txStatusColor[s] || 'default'}>{displayLabel(s)}</Tag>,
    },
  ];

  const statusColumns = [
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusColor[s]}>{displayLabel(s)}</Tag> },
    { title: '数量', dataIndex: 'count', key: 'count', align: 'right' as const },
  ];

  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>
        经营概览
      </Title>
      <Typography.Paragraph type="secondary">财务登记日期与时间以门店时区 {data.timezone} 为准。</Typography.Paragraph>
      <Card title="门店运营" style={{ marginBottom: 20 }}><Space wrap>{can('BOOKINGS_READ') && <Link to={selected('/bookings')}><Button>预约与操作</Button></Link>}{can('RESERVATION_CONFIG') && <Link to={selected('/reservations')}><Button>预约设置</Button></Link>}{can('OWNER_ONLY') && <><Link to={selected('/after-sales')}><Button>售后工单</Button></Link><Link to={selected('/gifts')}><Button>礼品权益</Button></Link></>}</Space><Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>以下数据来自已登记预约与内部账本。促销赠送权益不产生销售收入，外部结算转账另行处理。</Typography.Paragraph></Card>
      {!finance && <Alert style={{ marginBottom: 20 }} type="info" showIcon title="账本尚未配置" description="请联系平台配置本店账本。收入及近期交易暂不可用，预约和评价统计仍可正常查看。" />}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="累计收入"
              value={finance ? finance.overview.totalRevenue / 100 : '未配置'}
              precision={finance ? 2 : undefined}
              prefix={finance ? <DollarOutlined style={{ color: '#52c41a' }} /> : undefined}
              suffix={finance ? 'USD' : undefined}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="累计预约"
              value={overview.totalBookings}
              prefix={<CalendarOutlined style={{ color: '#1890ff' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="净收入"
              value={finance ? finance.overview.netRevenue / 100 : '未配置'}
              precision={finance ? 2 : undefined}
              prefix={finance ? <WalletOutlined style={{ color: '#722ed1' }} /> : undefined}
              suffix={finance ? 'USD' : undefined}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic
              title="平均评分"
              value={overview.avgRating}
              precision={1}
              prefix={<StarOutlined style={{ color: '#faad14' }} />}
              suffix="/ 5"
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={14}>
          <Card title="近期交易">
            {finance ? <Table
              dataSource={finance.recentTransactions}
              columns={txColumns}
              rowKey="id"
              pagination={false}
              size="small"
              locale={{ emptyText: <Empty description="暂无交易" /> }}
            /> : <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>账本尚未配置，暂无法显示交易记录。请联系平台完成配置。</Typography.Paragraph>}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="预约状态">
            <Table
              dataSource={data.bookingStatusDistribution}
              columns={statusColumns}
              rowKey="status"
              pagination={false}
              size="small"
              locale={{ emptyText: <Empty description="暂无预约" /> }}
            />
            <div style={{ marginTop: 12, color: '#888', fontSize: 13 }}>
              <Rate disabled value={overview.avgRating} allowHalf /> · {overview.totalReviews} 条评价
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}
