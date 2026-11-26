import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { merchantLogin } from '../../api/auth';
import { merchantPostLoginTarget } from '../../utils/loginNavigation';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const location = useLocation();
  async function submit(values: { identifier: string; password: string }) {
    if (loading) return;
    setLoading(true); setError(null);
    try {
      await merchantLogin(values.identifier.trim(), values.password);
      navigate(merchantPostLoginTarget(location.search), { replace: true });
    } catch (err: any) {
      form.setFieldValue('password', '');
      setError(err?.response?.data?.message || err?.message || '无法登录。');
    } finally { setLoading(false); }
  }
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#f4faf7' }}>
    <Card style={{ width: '100%', maxWidth: 420, borderRadius: 12 }}>
      <Typography.Text style={{ color: '#0d6b5e' }} strong>Massajoy</Typography.Text>
      <Typography.Title level={2} style={{ marginTop: 8 }}>商家后台登录</Typography.Title>
      <Typography.Paragraph type="secondary">店主请使用平台已启用的门店邮箱账号；员工请使用门店负责人已授权的员工账号。</Typography.Paragraph>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 20 }} />}
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="identifier" label="账号／邮箱" rules={[{ required: true, whitespace: true, message: '请输入门店登录名、邮箱或手机号码。' }]}>
          <Input type="text" prefix={<UserOutlined />} placeholder="门店登录名、邮箱或手机号码" autoComplete="username" size="large" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码。' }]}>
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
        </Form.Item>
        <Button htmlType="submit" type="primary" size="large" block loading={loading}>登录</Button>
      </Form>
      <details style={{ marginTop: 20, color: '#526474', lineHeight: 1.7 }}>
        <summary style={{ cursor: 'pointer', color: '#287c7c' }}>账号如何获取／忘记密码</summary>
        <p>店主账号由平台绑定门店邮箱并启用。导入账号不代表已获登录权限；请向平台对接人确认启用状态并领取初始密码。</p>
        <p>员工账号和门店职责由门店负责人分配；没有看到门店时，请先联系负责人核对授权。</p>
        <p>忘记密码请联系为您开通账号的平台对接人，核验身份后处理；员工可请门店负责人协助联系。本页不提供自动重置，请勿发送旧密码。</p>
        <p style={{ marginBottom: 0 }}>公司管理员也可使用管理账号登录，进入后会保留管理员身份。</p>
      </details>
    </Card>
  </div>;
}
