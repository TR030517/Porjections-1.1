import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Alert, Layout, Menu, Button, Select, Typography, Space, message, Drawer, Grid } from 'antd';
import {
  DashboardOutlined,
  CalendarOutlined,
  TeamOutlined,
  DollarOutlined,
  TagOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ScheduleOutlined,
  ReloadOutlined,
  CustomerServiceOutlined,
  GiftOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../stores/authStore';
import { endSession } from '../api/client';
import { useShopId } from '../hooks/useShopId';
import { type ShopPermission } from '../utils/shopPermissions';
import { MerchantDraftGuard, useMerchantLeaveConfirmation } from '../components/MerchantDraftGuard';
import { authorizedShopOptions, matchesAuthorizedShop } from '../utils/authorizedShopOptions';
import AccountSecurityDialog from '../../../src/components/AccountSecurityDialog';
import { changeOwnPassword, currentManagementSessionKey, discardManagementSession } from '../api/accountSecurity';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '经营概览' },
  { key: '/bookings', icon: <CalendarOutlined />, label: '预约管理' },
  { key: '/reservations', icon: <ScheduleOutlined />, label: '预约设置' },
  { key: '/after-sales', icon: <CustomerServiceOutlined />, label: '售后管理' },
  { key: '/price-menu', icon: <TagOutlined />, label: '服务与价格' },
  { key: '/technicians', icon: <TeamOutlined />, label: '技师管理' },
  { key: '/earnings', icon: <DollarOutlined />, label: '收益账本' },
  { key: '/coupons', icon: <TagOutlined />, label: '优惠券' },
  { key: '/gifts', icon: <GiftOutlined />, label: '礼品权益' },
  { key: '/staff', icon: <TeamOutlined />, label: '员工权限' },
  { key: '/copy-config', icon: <SettingOutlined />, label: '复制门店设置' },
  { key: '/settings', icon: <SettingOutlined />, label: '门店设置' },
];

const routePermissions: Record<string, ShopPermission | 'OWNER_ONLY'> = { '/dashboard':'FINANCE_READ', '/bookings':'BOOKINGS_READ', '/reservations':'RESERVATION_CONFIG', '/earnings':'FINANCE_READ', '/services':'CATALOG_MANAGE', '/price-menu':'CATALOG_MANAGE', '/technicians':'CATALOG_MANAGE', '/settings':'SHOP_SETTINGS_MANAGE', '/copy-config':'COPY_CONFIG' };

export default function MerchantLayout() {
  return <MerchantDraftGuard><MerchantWorkspace /></MerchantDraftGuard>;
}

function MerchantWorkspace() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [securityOwner, setSecurityOwner] = useState<string | null>(null);
  const screens = Grid.useBreakpoint();
  const mobile = !screens.lg;
  const navigate = useNavigate();
  const location = useLocation();
  const merchant = useAuthStore((s) => s.merchant);
  const sessionKey = currentManagementSessionKey();
  const { shops, shopId, selectShop, loading, refreshing, error, retry, can, shop } = useShopId();
  const confirmLeave = useMerchantLeaveConfirmation();
  useEffect(() => {
    if (!shopId) return;
    const params = new URLSearchParams(location.search);
    if (params.get('shopId') !== shopId) { params.set('shopId', shopId); navigate({ pathname: location.pathname, search: '?' + params }, { replace: true }); }
  }, [shopId, location.pathname, location.search, navigate]);
  const navigation = <Menu mode="inline" selectedKeys={[location.pathname]} items={menuItems.filter(item => item.key === '/price-menu' ? can('CATALOG_MANAGE') || can('RESERVATION_CONFIG') : can(routePermissions[item.key] ?? 'OWNER_ONLY'))} onClick={({ key }) => { navigate({ pathname: key, search: shopId ? '?shopId=' + encodeURIComponent(shopId) : '' }); setMobileOpen(false); }} style={{ borderRight: 0 }} />;

  const handleLogout = async () => {
    if (!await confirmLeave()) return;
    try { await endSession(); }
    catch { message.warning('已在本地退出，但无法连接服务器注销会话。'); }
    finally { navigate('/login', { replace: true }); }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!mobile && <Sider
        width={240}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
        style={{
          borderRight: '1px solid #e5eaf0',
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid #e5eaf0',
          }}
        >
          <Text strong style={{ fontSize: collapsed ? 16 : 20, color: '#287c7c' }}>
            {collapsed ? 'M' : 'Massajoy'}
          </Text>
        </div>
        {navigation}
      </Sider>}
      <Drawer title="Massajoy · 商家后台" placement="left" open={mobile && mobileOpen} onClose={() => setMobileOpen(false)} width={280} styles={{ body: { padding: 0 } }}>{navigation}</Drawer>
      <Layout style={{ minWidth: 0 }}>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            height: 'auto', minHeight: 64, gap: 12, flexWrap: 'wrap', paddingBlock: 12,
          }}
        >
          <Space>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              aria-label={mobile ? '打开导航' : '展开或收起导航'}
              onClick={() => mobile ? setMobileOpen(true) : setCollapsed(!collapsed)}
            />
            <Text strong style={{ fontSize: 16 }}>
              {merchant?.name || merchant?.loginName || merchant?.email || '商家后台'}
            </Text>
          </Space>
          <Select
            aria-label="已授权门店"
            placeholder="搜索门店名称、ID、短链或城市"
            value={shopId ?? undefined}
            loading={loading || refreshing}
            disabled={loading || refreshing || !shops.length}
            showSearch={{ filterOption: matchesAuthorizedShop }}
            options={authorizedShopOptions(shops)}
            notFoundContent="没有匹配的已授权门店"
            onChange={selectShop}
            style={{ minWidth: 180, maxWidth: '100%', flex: '1 1 230px' }}
          />
          <Button aria-label="刷新授权门店与权限" icon={<ReloadOutlined />} loading={loading || refreshing} onClick={() => void retry()}>刷新权限</Button>
          <Button icon={<SafetyOutlined />} onClick={async () => { const owner = currentManagementSessionKey(); if (owner && await confirmLeave() && currentManagementSessionKey() === owner) setSecurityOwner(owner); }}>账号与安全</Button>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={handleLogout}
            danger
          >
            退出登录
          </Button>
        </Header>
        {merchant?.role && sessionKey && securityOwner === sessionKey && <AccountSecurityDialog key={sessionKey} account={{ ...merchant, role: merchant.role }} sessionKey={sessionKey} changePassword={async input => {
          await changeOwnPassword(input);
          if (!useAuthStore.getState().token) { message.success('密码已修改，请使用新密码重新登录。'); navigate('/login', { replace: true }); }
        }} onClose={() => setSecurityOwner(null)} onReauthenticate={() => { if (discardManagementSession(sessionKey)) navigate('/login', { replace: true }); }} />}
        <Content className="merchant-content">
          {shop && <Alert style={{ marginBottom: 16 }} type="info" showIcon title={merchant?.role === 'ADMIN' || shop.accessType === 'ADMIN' ? '公司管理员管理门店' : shop.accessType === 'ASSOCIATED' ? '关联门店工作区' : merchant?.role === 'STAFF' ? '已授权员工工作区' : '独立门店工作区'} description={`当前操作门店：${shop.name}；当前登录：${merchant?.name || merchant?.loginName || merchant?.email || '账号编号 #' + merchant?.id}。切换门店仅改变已授权的工作区，不会登录为其他门店账号。`} />}
          {error && <Alert type="warning" showIcon title={error} description={shop ? '当前门店草稿仍保留。请重试刷新权限后再保存。' : undefined} action={<Button onClick={() => void retry()}>重试</Button>} />}
          {(!error || shop) && <Outlet key={(merchant?.id ?? '') + ':' + (shopId ?? 'unselected')} />}
        </Content>
      </Layout>
    </Layout>
  );
}
