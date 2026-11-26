import { displayLabel } from '../../utils/displayLabels';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import PageHeader from '../../components/PageHeader';
import { createStaff, getStaff, grantStaff, revokeStaff, updateStaff, type StaffGrant, type StaffPage as StaffResult } from '../../api/staff';
import { isCurrentShop, useShopId } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import { permissionLabels, staffPermissions, withBookingRead, type ShopPermission } from '../../utils/shopPermissions';
import { errorMessage } from '../../utils/feedback';
import { passwordPolicyError } from '../../../../backend/src/common/password-policy';

type Editor = { kind: 'create' | 'grant' | 'edit'; row?: StaffGrant };
interface Values { name: string; email: string; phone: string; password: string; userId: string; permissions: ShopPermission[]; }
export default function StaffPage() {
  const { shopId, shop, can } = useShopId();
  const account = useAuthStore(state => state.merchant?.id);
  const [data, setData] = useState<StaffResult | null>(null), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null), [formError, setFormError] = useState('');
  const [form] = Form.useForm<Values>(), [modal, modalContext] = Modal.useModal();
  const mounted = useRef(true), operation = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; form.resetFields(); }; }, [form]);
  const current = () => mounted.current && !!shopId && isCurrentShop(shopId) && useAuthStore.getState().merchant?.id === account;
  useEffect(() => { setPage(1); setData(null); setEditor(null); form.resetFields(); }, [shopId, account, form]);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('');
    if (!shopId || !can('OWNER_ONLY')) return;
    setLoading(true);
    getStaff(shopId, page, controller.signal).then(value => { if (!controller.signal.aborted && current()) setData(value); })
      .catch(e => { if (!controller.signal.aborted && current()) setError(errorMessage(e)); })
      .finally(() => { if (!controller.signal.aborted && current()) setLoading(false); });
    return () => controller.abort();
  }, [shopId, account, page, reload]);
  const open = (kind: Editor['kind'], row?: StaffGrant) => { form.resetFields(); form.setFieldsValue({ permissions: row?.permissions ?? [] }); setFormError(''); setEditor({ kind, row }); };
  const close = () => { if (busy) return; setEditor(null); form.resetFields(); setFormError(''); };
  const submit = async (values: Values) => {
    if (!shopId || !editor || operation.current || !current()) return;
    const permissions = withBookingRead(values.permissions ?? []);
    operation.current = true; setBusy(true); setFormError(''); setNotice('');
    try {
      if (editor.kind === 'create') await createStaff(shopId, { name: values.name.trim(), email: values.email.trim().toLowerCase(), phone: values.phone.trim(), password: values.password, permissions });
      else if (editor.kind === 'grant') await grantStaff(shopId, values.userId.trim(), permissions);
      else await updateStaff(shopId, editor.row!.userId, permissions);
      if (!current()) return;
      setEditor(null); form.resetFields(); setReload(value => value + 1); setNotice('员工权限已保存，列表已从服务器刷新。');
    } catch (e) { if (current()) setFormError(errorMessage(e)); }
    finally { operation.current = false; if (current()) setBusy(false); }
  };
  const revoke = async (row: StaffGrant) => {
    if (!shopId || operation.current || !current() || !await modal.confirm({ title: '撤销该门店权限？', content: `${row.name || '员工'} · #${row.userId}。此操作仅撤销选定门店的授权，保留该账号和其他门店授权。`, okText: '撤销权限', okButtonProps: { danger: true } }) || !current()) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    try { await revokeStaff(shopId, row.userId); if (current()) { setReload(value => value + 1); setNotice('已撤销该门店权限。'); } }
    catch (e) { if (current()) setError(errorMessage(e)); }
    finally { operation.current = false; if (current()) setBusy(false); }
  };
  return <div className="merchant-page">{modalContext}<PageHeader title="员工权限" description={`分配职责，门店为${shop?.name ?? '所选门店'}。员工不会获得店主权限。`} actions={<Space wrap><Button icon={<ReloadOutlined />} disabled={busy || !!editor} loading={loading} onClick={() => setReload(value => value + 1)}>刷新</Button><Button icon={<UserAddOutlined />} disabled={busy} onClick={() => open('grant')}>授权已有员工编号</Button><Button type="primary" icon={<PlusOutlined />} disabled={busy} onClick={() => open('create')}>创建员工账号</Button></Space>} />
    <Alert type="info" showIcon title="门店独立授权，由服务器核验" description="预约操作、收款与退款也需要查看预约权限。员工不能管理员工、归属、付款规则、营销、礼品或售后工单。撤销权限会在后续授权操作中生效。" />
    {error && <Alert type="error" showIcon title={error} />}{notice && <Alert type="success" showIcon title={notice} />}
    <Card><Table<StaffGrant> rowKey="userId" dataSource={data?.items ?? []} loading={loading} scroll={{ x: 980 }} pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, showSizeChanger: false, disabled: busy || !!editor, onChange: setPage }} columns={[
      { title: '员工', render: (_, row) => <><strong>{row.name || '未命名员工'}</strong><p className="merchant-secondary">#{row.userId} · {row.email}</p></> },
      { title: '账号', dataIndex: 'accountStatus', render: value => displayLabel(value) }, { title: '门店权限', render: (_, row) => <Tag color={row.status === 'ACTIVE' ? 'cyan' : 'default'}>{displayLabel(row.status)}</Tag> },
      { title: '职责', render: (_, row) => row.permissions.length ? <Space size={4} wrap>{row.permissions.map(permission => <Tag key={permission}>{permissionLabels[permission]}</Tag>)}</Space> : <Typography.Text type="secondary">暂无权限</Typography.Text> },
      { title: '操作', render: (_, row) => <Space wrap><Button disabled={busy || row.status !== 'ACTIVE'} onClick={() => open('edit', row)}>编辑权限</Button><Button danger disabled={busy || row.status !== 'ACTIVE'} onClick={() => void revoke(row)}>撤销</Button></Space> },
    ]} /></Card>
    <Modal open={!!editor} title={editor?.kind === 'create' ? '创建员工账号' : editor?.kind === 'grant' ? '授权已有员工账号' : `编辑员工编号 #${editor?.row?.userId ?? ''}`} onCancel={close} footer={null} maskClosable={false} closable={!busy} destroyOnHidden>
      {formError && <Alert type="error" showIcon title={formError} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" onFinish={values => void submit(values)} disabled={busy}>
        {editor?.kind === 'create' && <><Typography.Paragraph type="secondary">将创建新员工账号，不转换已有顾客或门店负责人账号。系统不发送邮件，页面不保存初始密码。</Typography.Paragraph><Form.Item name="name" label="员工姓名" rules={[{ required: true, whitespace: true, max: 100 }]}><Input autoComplete="off" maxLength={100} /></Form.Item><Form.Item name="email" label="登录邮箱" rules={[{ required: true, type: 'email', max: 255 }]}><Input autoComplete="off" maxLength={255} /></Form.Item><Form.Item name="phone" label="含国家区号的电话" rules={[{ required: true, pattern: /^\+[1-9]\d{7,14}$/, message: '请填写国际格式号码，例如+12025550123。' }]}><Input autoComplete="off" maxLength={16} /></Form.Item><Form.Item name="password" label="初始密码" rules={[{ required: true }, { validator: (_, value: string) => { const message = passwordPolicyError(value, 'STAFF'); return message ? Promise.reject(new Error(message)) : Promise.resolve(); } }]}><Input.Password autoComplete="new-password" /></Form.Item></>}
        {editor?.kind === 'grant' && <><Typography.Paragraph type="secondary">请输入管理员提供的已有员工账号编号。此页面不搜索全部账号或改变账号身份。</Typography.Paragraph><Form.Item name="userId" label="已有员工账号编号" rules={[{ required: true, pattern: /^[1-9]\d{0,18}$/, message: '请输入正整数员工编号。' }]}><Input inputMode="numeric" maxLength={19} /></Form.Item></>}
        <Form.Item name="permissions" label="本店职责" extra="预约操作、收款与退款权限将自动包含查看预约权限；权限为空时无权操作。"><Select mode="multiple" options={staffPermissions.map(value => ({ value, label: permissionLabels[value] }))} onChange={values => form.setFieldValue('permissions', withBookingRead(values))} /></Form.Item>
        <Space><Button type="primary" htmlType="submit" loading={busy}>保存员工权限</Button><Button disabled={busy} onClick={close}>取消</Button></Space>
      </Form>
    </Modal>
  </div>;
}
