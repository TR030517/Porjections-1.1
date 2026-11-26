import { useEffect, useRef, useState } from 'react';
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Tag,
  Popconfirm,
  message,
  Typography,
  Card,
  Alert,
} from 'antd';
import { PlusOutlined, ReloadOutlined, TagOutlined } from '@ant-design/icons';
import { merchantCouponsApi } from '../../api/coupons';
import type { MerchantCoupon, CreateCouponDto } from '../../api/coupons';
import { isCurrentShop, useShopId } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import { toIsoDateTime, toLocalDateTimeInput } from '../../utils/dateTime';
import { couponValueForApi, couponEditableTerms, couponMinSpendDraft, couponMinSpendForApi } from '../../utils/couponValue';

const { Title } = Typography;

const TYPES = [
  { label: '固定金额', value: 'FIXED_AMOUNT' },
  { label: '百分比', value: 'PERCENT' },
];
const STATUSES = [
  { label: '草稿', value: 'DRAFT' },
  { label: '已启用', value: 'ACTIVE' },
  { label: '已暂停', value: 'PAUSED' },
];

export default function CouponsPage() {
  const { shopId, loading, error, retry } = useShopId();
  const actor = useAuthStore(state => state.merchant?.id);
  if (loading) return <Card>正在载入授权门店…</Card>;
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={() => void retry()}>重试</Button>} />;
  if (!shopId) return <Alert type="info" showIcon title="请选择已授权门店。" />;
  return <ShopCouponsPage key={shopId + ':' + actor} shopId={shopId} />;
}

function ShopCouponsPage({ shopId }: { shopId: string }) {
  const [items, setItems] = useState<MerchantCoupon[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MerchantCoupon | null>(null);
  const [form] = Form.useForm();
  const couponType = Form.useWatch('type', form) || 'FIXED_AMOUNT';
  const termsLocked = Boolean(editing && editing.claimedCount > 0);
  const historicalLimit = editing?.configuredPerUserLimit ?? editing?.perUserLimit ?? 1;
  const alive = useRef(true), loadVersion = useRef(0), locked = useRef(false);
  const current = () => alive.current && isCurrentShop(shopId);

  const load = async () => {
    if (!current()) return;
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const list = await merchantCouponsApi.list(shopId);
      if (!current() || version !== loadVersion.current) return;
      if (!Array.isArray(list) || list.some(coupon => String(coupon.shopId) !== shopId)) throw new Error('无法核对所选门店的优惠券列表。');
      setItems(list);
      setError(null);
    } catch (e: any) {
      if (current() && version === loadVersion.current) { setItems([]); setError(e?.response?.data?.message || e?.message || '优惠券加载失败'); }
    } finally {
      if (current() && version === loadVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    alive.current = true; void load();
    return () => { alive.current = false; loadVersion.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  const openCreate = () => {
    if (locked.current || !current()) return;
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'FIXED_AMOUNT', status: 'ACTIVE', perUserLimit: 1, totalQuantity: 0, minSpendUsd: 0 });
    setModalOpen(true);
  };

  const openEdit = (c: MerchantCoupon) => {
    if (locked.current || !current() || String(c.shopId) !== shopId) return;
    setEditing(c);
    form.setFieldsValue({
      title: c.title,
      description: c.description ?? '',
      type: c.type,
      // FIXED_AMOUNT is stored in cents; show as dollars in the form
      value: c.type === 'FIXED_AMOUNT' ? (c.value ?? 0) / 100 : c.value,
      minSpendUsd: couponMinSpendDraft(c.minSpendCents),
      totalQuantity: c.totalQuantity,
      perUserLimit: 1,
      status: c.status,
      validFrom: toLocalDateTimeInput(c.validFrom),
      validUntil: toLocalDateTimeInput(c.validUntil),
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (locked.current || !current()) return;
    let values;
    try { values = await form.validateFields(); } catch { return; }
    if (locked.current || !current()) return;
    locked.current = true;
    setSaving(true);
    try {
    const shared = { title: values.title, description: values.description ?? '', totalQuantity: values.totalQuantity ?? 0, status: values.status };
    const dto: CreateCouponDto = {
      ...shared,
      type: values.type,
      // FIXED_AMOUNT: convert dollars -> cents; PERCENT: pass through
      value: editing?.value ?? 0,
      ...couponEditableTerms(values, termsLocked),
      validFrom: toIsoDateTime(values.validFrom, editing?.validFrom) ?? undefined,
      validUntil: toIsoDateTime(values.validUntil, editing?.validUntil),
    };
      if (editing) {
        await merchantCouponsApi.update(shopId, editing.id, termsLocked ? shared : dto);
        if (!current()) return;
        message.success('优惠券已更新');
      } else {
        await merchantCouponsApi.create(shopId, dto);
        if (!current()) return;
        message.success('优惠券已创建');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      if (current()) message.error(e?.response?.data?.message || e?.message || '保存失败');
    } finally { locked.current = false; if (current()) setSaving(false); }
  };

  const handleStatus = async (c: MerchantCoupon, status: string) => {
    if (locked.current || !current() || String(c.shopId) !== shopId) return;
    locked.current = true; setSaving(true);
    try {
      await merchantCouponsApi.updateStatus(shopId!, c.id, status);
      if (!current()) return;
      message.success('状态已更新');
      load();
    } catch (e: any) {
      if (current()) message.error(e?.response?.data?.message || '状态更新失败');
    } finally { locked.current = false; if (current()) setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (locked.current || !current() || !items.some(coupon => coupon.id === id && String(coupon.shopId) === shopId)) return;
    locked.current = true; setSaving(true);
    try {
      await merchantCouponsApi.remove(shopId!, id);
      if (!current()) return;
      message.success('优惠券已删除');
      load();
    } catch (e: any) {
      if (current()) message.error(e?.response?.data?.message || '删除失败');
    } finally { locked.current = false; if (current()) setSaving(false); }
  };

  const statusTag = (s: string) => {
    const map: Record<string, string> = { DRAFT: 'default', ACTIVE: 'green', PAUSED: 'orange', EXPIRED: 'red' };
    return <Tag color={map[s] || 'default'}>{s}</Tag>;
  };

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (t: string) => <span style={{ fontWeight: 600 }}>{t}</span>,
    },
    {
      title: '优惠值',
      dataIndex: 'value',
      width: 110,
      render: (v: number, r: MerchantCoupon) => (r.type === 'PERCENT' ? `${v}%` : `$${(v / 100).toFixed(2)}`),
    },
    {
      title: '最低消费',
      dataIndex: 'minSpendCents',
      width: 100,
      render: (v: number) => (v > 0 ? `$${(v / 100).toFixed(2)}` : '无'),
    },
    {
      title: '已领取／已使用',
      width: 120,
      render: (_: any, r: MerchantCoupon) => `${r.claimedCount} / ${r.usedCount}`,
    },
    { title: '每人限领', width: 170, render: (_: unknown, r: MerchantCoupon) => <span>1 张{(r.configuredPerUserLimit ?? r.perUserLimit) > 1 && <Typography.Text type="warning" style={{ display: 'block', fontSize: 12 }}>历史配置 {r.configuredPerUserLimit ?? r.perUserLimit}，当前实际 1 张</Typography.Text>}</span> },
    {
      title: '有效期',
      width: 190,
      render: (_: any, r: MerchantCoupon) => (
        <span style={{ fontSize: 12 }}>
          {r.validFrom?.slice(0, 10)}
          {r.validUntil ? ` → ${r.validUntil.slice(0, 10)}` : ' → ∞'}
        </span>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => statusTag(s) },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: any, r: MerchantCoupon) => (
        <Space>
          <Button size="small" disabled={saving || loading} onClick={() => openEdit(r)}>编辑</Button>
          {r.status === 'ACTIVE' ? (
            <Button size="small" disabled={saving || loading} onClick={() => handleStatus(r, 'PAUSED')}>暂停</Button>
          ) : (
            <Button size="small" type="primary" ghost disabled={saving || loading} onClick={() => handleStatus(r, 'ACTIVE')}>启用</Button>
          )}
          <Popconfirm title="删除该优惠券？" disabled={saving || loading} onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger disabled={saving || loading}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <TagOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>门店优惠券</Title>
            <span style={{ color: '#888', fontSize: 13 }}>
              为本店顾客创建优惠券，平台优惠券由公司管理员管理。
            </span>
          </div>
        </Space>
      </Card>

      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Typography.Paragraph type="secondary">显示所选门店最近100张优惠券。</Typography.Paragraph>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>优惠券</h2>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={loading || saving}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={loading || saving}>
            新增优惠券
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{ pageSize: 10, showSizeChanger: false }}
      />

      <Modal
        title={editing ? '编辑优惠券' : '新增优惠券'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => { if (!saving) setModalOpen(false); }}
        confirmLoading={saving}
        width={560}
      >
        <Form form={form} layout="vertical" disabled={saving}>
          {termsLocked && <Alert type="info" showIcon title="已有顾客领取此券，不可修改优惠值、资格或有效期。如需不同规则，请新建优惠券。" style={{ marginBottom: 16 }} />}
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}>
            <Input placeholder="例如：足疗八折" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input placeholder="简短说明（可选）" />
          </Form.Item>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="type" label="类型" style={{ width: 160 }} rules={[{ required: true }]}>
              <Select options={TYPES} disabled={termsLocked} />
            </Form.Item>
            <Form.Item
              name="value"
              label={couponType === 'PERCENT' ? '优惠比例（%）' : '优惠金额（美元）'}
              style={{ width: 180 }}
              dependencies={['type']}
              rules={[{ required: true, message: '请填写优惠值' }, ({ getFieldValue }) => ({
                validator: async (_, value) => {
                  if (!termsLocked) couponValueForApi(getFieldValue('type'), value);
                },
              })]}
            >
              <InputNumber
                min={couponType === 'PERCENT' ? 1 : 0.01}
                disabled={termsLocked}
                max={couponType === 'PERCENT' ? 100 : 10000}
                step={couponType === 'PERCENT' ? 1 : 0.01}
                changeOnBlur={false}
                
                style={{ width: '100%' }}
                placeholder={couponType === 'PERCENT' ? 'e.g. 20' : 'e.g. 15.00'}
              />
            </Form.Item>
            <Form.Item name="minSpendUsd" label="最低消费（USD）" style={{ flex: 1 }} extra="0 表示无最低消费；最多两位小数。" rules={[{ validator: async (_, value) => { if (!termsLocked) couponMinSpendForApi(value ?? 0); } }]} >
              <InputNumber min={0} max={21474836.47} step={0.01} changeOnBlur={false} disabled={termsLocked} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="totalQuantity" label="总数量（0表示不限）" style={{ width: 220 }}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="perUserLimit" label="每人限领数量" style={{ width: 140 }} extra="当前固定为 1 张，与发行总量分别管理。">
              <InputNumber min={1} max={1} precision={0} readOnly style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ flex: 1 }} rules={[{ required: true }]}>
              <Select options={STATUSES} />
            </Form.Item>
          </Space>
          {historicalLimit > 1 && <Alert type="warning" showIcon title={`历史配置为每人 ${historicalLimit} 张，当前实际最多领取 1 张`} description={termsLocked ? '不代表顾客曾领取多张。已有领取记录，本次保留历史规则记录。' : '不代表顾客曾领取多张。保存后将明确设为每人 1 张。'} style={{ marginBottom: 16 }} />}
          <Space style={{ display: 'flex' }}>
            <Form.Item name="validFrom" label="生效时间（您当地时间）" style={{ width: 220 }}>
              <Input type="datetime-local" disabled={termsLocked} />
            </Form.Item>
            <Form.Item name="validUntil" label="失效时间（您当地时间）" style={{ width: 220 }}>
              <Input type="datetime-local" disabled={termsLocked} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
