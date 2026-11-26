import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Avatar, Button, Card, Collapse, Empty, Form, Input, InputNumber, Modal, Select, Space, Spin, Switch, Tag, Typography, message } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { staffingDisplayName, type StaffMember } from '../../../../src/utils/shopStaffing';
import { updateTechnician, type CreateTechnicianDto } from '../../api/merchant';
import { getStaffing, setStaffing } from '../../api/staffCount';
import { currentShopAllows, isCurrentShop, useShopId } from '../../hooks/useShopId';
import { useAuthStore } from '../../stores/authStore';
import PageHeader from '../../components/PageHeader';
import { useMerchantDraftProtection } from '../../components/MerchantDraftGuard';
import { createCatalogScope } from '../../utils/catalogScope';
import { createStaffingEditor, type StaffingEditorState } from '../../utils/staffingEditor';
import { reservationEntryHref } from '../../utils/entryNavigation';
import { errorMessage } from '../../utils/feedback';

const GENDERS = [{ value: 'MALE', label: '男' }, { value: 'FEMALE', label: '女' }, { value: 'OTHER', label: '其他' }];
const reviewRequired = (state: StaffingEditorState) => state.outcome === 'UNKNOWN' || state.outcome === 'CONFLICT';
interface ProfileValues { name: string; title: string; bio: string; avatar: string; yearsExp: number; gender?: string | null; isActive: boolean }
interface ProfileAttempt { id: string; shopId: string; payload: ReturnType<typeof technicianProfilePayload> }

function profileMatches(value: unknown, attempt: ProfileAttempt) {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return String(row.id) === attempt.id && String(row.shopId) === attempt.shopId
    && Object.entries(attempt.payload).every(([key, expected]) => row[key] === expected || expected === '' && row[key] === null);
}

export function technicianProfilePayload(person: StaffMember, values: Partial<ProfileValues>): Partial<CreateTechnicianDto> & { isActive?: boolean } {
  if (typeof values.name !== 'string' || !values.name.trim()) throw new Error('请填写顾客看到的姓名。');
  const payload: Partial<CreateTechnicianDto> & { isActive?: boolean } = { name: values.name };
  if (values.title !== undefined && values.title !== (person.title ?? '')) payload.title = values.title;
  if (values.bio !== undefined && values.bio !== (person.bio ?? '')) payload.bio = values.bio;
  if (values.avatar !== undefined && values.avatar !== (person.avatarUrl ?? '')) payload.avatarUrl = values.avatar;
  if (values.yearsExp !== undefined && values.yearsExp !== person.yearsExp) payload.yearsExp = values.yearsExp;
  if ((values.gender ?? null) !== person.gender && Object.hasOwn(values, 'gender')) payload.gender = values.gender ?? null;
  if (values.isActive !== undefined && values.isActive !== person.isActive) payload.isActive = values.isActive;
  return payload;
}

export function StaffingCountPanel({ state, disabled, readDisabled = false, onChange, onSave, onRead, onReviewed }: {
  state: StaffingEditorState; disabled: boolean; readDisabled?: boolean; onChange: (value: number | null) => void;
  onSave: () => void; onRead: () => void; onReviewed: () => void;
}) {
  const frozen = reviewRequired(state), canWrite = state.snapshot?.canManageStaff === true && !disabled;
  return <Card title="在岗人数" style={{ marginBottom: 16 }}>
    <Typography.Paragraph>填写人数即可建立本店团队。新增技师默认跟随门店营业时间，可承接本店全部项目；已有资料和个人工作时间保持原样。</Typography.Paragraph>
    <Space wrap>
      <InputNumber aria-label="在岗人数" min={0} max={100} precision={0} value={state.target}
        disabled={!canWrite || state.loading || state.saving || frozen || !state.verified} onChange={onChange} addonAfter="人" />
      {state.snapshot?.canManageStaff && <Button type="primary" loading={state.saving} disabled={!canWrite || state.loading || frozen || !state.verified || state.target === state.snapshot.activeCount} onClick={onSave}>保存人数</Button>}
      <Button loading={state.loading} disabled={state.saving || readDisabled} onClick={onRead}>{frozen ? '重新读取并核对' : '刷新人数'}</Button>
    </Space>
    <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
      {state.snapshot ? `${state.verified ? '当前已保存' : '上次读取'}：${state.snapshot.activeCount}人在岗。` : '正在读取本店人员。'} 减员会停用没有有效预约占用的技师；若可安全停用的人数不足，本次整批不改。
    </Typography.Paragraph>
    {state.snapshot && !state.snapshot.canManageStaff && <Alert style={{ marginTop: 12 }} type="info" showIcon title="当前账号可查看人员；调整人数需要技师管理权限。" />}
    {state.error && <Alert style={{ marginTop: 12 }} type={frozen ? 'warning' : 'error'} showIcon title={state.error} />}
    {frozen && state.reviewed && state.verified && <Alert style={{ marginTop: 12 }} type="info" showIcon
      title={`已重新读取：当前${state.snapshot?.activeCount}人在岗，原目标${state.target}人。请核对下方人员。`}
      action={<Button onClick={onReviewed}>已核对，继续调整</Button>} />}
    {state.outcome === 'SAVED' && <Alert style={{ marginTop: 12 }} type="success" showIcon title={`已保存${state.snapshot?.activeCount}人在岗。`} />}
  </Card>;
}

export function TechnicianCards({ staff, disabled, onEdit }: { staff: readonly StaffMember[]; disabled: boolean; onEdit: (staff: StaffMember) => void }) {
  if (!staff.length) return <Empty description="尚无技师。先在上方填写在岗人数并保存。" />;
  return <div style={{ display: 'grid', gap: 12 }}>{staff.map(person => <Card key={person.id} size="small">
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <Avatar src={person.avatarUrl || undefined} icon={<UserOutlined />} />
      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
        <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>{staffingDisplayName(person.name)}</Typography.Text>{' '}
        <Tag color={person.isActive ? 'green' : undefined}>{person.isActive ? '在岗' : '已停用'}</Tag>
        <div><Typography.Text type="secondary">{person.scheduleMode === 'CUSTOM' ? '保留个人工作时间' : '跟随门店营业时间'}</Typography.Text></div>
      </div>
      <Button disabled={disabled} onClick={() => onEdit(person)}>编辑资料</Button>
    </div>
  </Card>)}</div>;
}

export default function TechniciansPage() {
  const { shopId, loading: shopLoading, refreshing, error: shopError, can, retry } = useShopId();
  const actorId = useAuthStore(state => state.merchant?.id), navigate = useNavigate();
  const selectedShop = useRef(shopId); selectedShop.current = shopId;
  const lifetime = useRef({ actorId, shopId });
  const [scope] = useState(() => createCatalogScope(() => Boolean(lifetime.current.shopId && lifetime.current.actorId === useAuthStore.getState().merchant?.id && isCurrentShop(lifetime.current.shopId))));
  const [editor] = useState(() => createStaffingEditor({
    identity: () => {
      const actor = useAuthStore.getState().merchant?.id, shop = selectedShop.current;
      return actor && shop && isCurrentShop(shop) ? { actorId: actor, shopId: shop } : null;
    },
    canWrite: () => Boolean(selectedShop.current && currentShopAllows(selectedShop.current, 'CATALOG_MANAGE')),
    read: getStaffing, write: setStaffing,
  }));
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [modalOpen, setModalOpen] = useState(false), [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false);
  const [profileUnknown, setProfileUnknown] = useState(false), [profileReviewed, setProfileReviewed] = useState(false);
  const profileDraft = useRef<{ version: number; unknown: boolean; attempt: ProfileAttempt | null }>({ version: 0, unknown: false, attempt: null });
  const [profileVersion, setProfileVersion] = useState(0);
  const [formError, setFormError] = useState(''), [notice, setNotice] = useState('');
  const writing = useRef(false), [form] = Form.useForm<ProfileValues>(), [modal, modalContext] = Modal.useModal();
  const countDirty = state.snapshot !== null && state.target !== state.snapshot.activeCount;
  const countFrozen = reviewRequired(state), busy = saving || state.saving;
  const editable = Boolean(shopId && can('CATALOG_MANAGE') && state.snapshot?.canManageStaff && !refreshing && !shopError);
  const exceptions = Boolean(can('RESERVATION_CONFIG') && state.snapshot?.canManageExceptions);
  useMerchantDraftProtection(shopId ?? '', dirty || countDirty, busy || profileUnknown || state.outcome === 'UNKNOWN',
    () => writing.current || profileDraft.current.unknown || editor.getSnapshot().saving || editor.getSnapshot().outcome === 'UNKNOWN');
  const currentProfile = () => scope.current() && profileDraft.current.version === profileVersion;
  const resetProfile = () => {
    const version = profileDraft.current.version + 1;
    profileDraft.current = { version, unknown: false, attempt: null }; setProfileVersion(version);
    setProfileUnknown(false); setProfileReviewed(false);
  };
  const finishProfile = () => {
    resetProfile(); setModalOpen(false); setDirty(false); setEditing(null); setFormError('');
    setNotice('个人资料已保存并重新核对。');
  };

  useLayoutEffect(() => {
    lifetime.current = { actorId, shopId }; scope.activate(); editor.syncIdentity();
    writing.current = false; setEditing(null); setModalOpen(false); setDirty(false); setSaving(false);
    resetProfile(); setFormError(''); setNotice(''); form.resetFields();
    return () => { scope.dispose(); editor.dispose(); };
  }, [actorId, shopId, editor, scope, form]);
  useEffect(() => {
    const controller = new AbortController();
    if (shopId) void editor.load(controller.signal);
    return () => controller.abort();
  }, [actorId, shopId, editor]);

  const refresh = async () => {
    if (!currentProfile() || busy || writing.current) return;
    const current = scope.read(), ok = await editor.load();
    if (!current() || !currentProfile() || !ok || !profileDraft.current.unknown) return;
    const attempt = profileDraft.current.attempt;
    const row = editor.getSnapshot().snapshot?.therapists.find(person => person.id === attempt?.id);
    if (attempt && profileMatches(row, attempt)) finishProfile();
    else { setProfileReviewed(true); setFormError('已重新读取，但尚未核对到原修改；草稿仍保留，请继续只读核对或明确结束本次操作。'); }
  };
  const openEdit = (person: StaffMember) => {
    if (!editable || busy || writing.current || profileDraft.current.unknown || !currentProfile()) return;
    const latest = editor.getSnapshot();
    if (latest.target !== latest.snapshot?.activeCount || reviewRequired(latest) || latest.loading || !latest.verified) { message.info('请先保存或核对上方人数，再编辑个人资料。'); return; }
    const currentPerson = latest.snapshot?.therapists.find(row => row.id === person.id);
    if (!currentPerson) { message.info('此人的记录已改变，请重新读取本店人员。'); return; }
    resetProfile(); form.resetFields(); setEditing(currentPerson); setFormError(''); setNotice(''); setDirty(false);
    form.setFieldsValue({ name: currentPerson.name, title: currentPerson.title ?? '', gender: currentPerson.gender ?? undefined,
      yearsExp: currentPerson.yearsExp, bio: currentPerson.bio ?? '', avatar: currentPerson.avatarUrl ?? '', isActive: currentPerson.isActive });
    setModalOpen(true);
  };
  const close = async () => {
    if (busy || writing.current || profileDraft.current.unknown || !currentProfile()) return;
    const current = scope.read();
    if (dirty && !await modal.confirm({ title: '放弃尚未保存的个人资料？', okText: '放弃', cancelText: '继续编辑' })) return;
    if (current() && currentProfile() && !writing.current && !profileDraft.current.unknown) { resetProfile(); setModalOpen(false); setDirty(false); }
  };
  const saveProfile = async () => {
    const latest = editor.getSnapshot();
    if (!editing || !shopId || !modalOpen || !editable || !currentProfile() || writing.current || profileDraft.current.unknown || latest.loading || !latest.verified || latest.saving || reviewRequired(latest) || latest.target !== latest.snapshot?.activeCount) return;
    if (!latest.snapshot?.canManageStaff || !latest.snapshot.therapists.some(person => person.id === editing.id && person.shopId === shopId)) { setFormError('此人已不在当前门店，请关闭草稿并重新核对人员。'); return; }
    const task = scope.beginWrite();
    if (!task) return;
    writing.current = true; setSaving(true); setFormError('');
    let dispatched = false;
    try {
      const values: ProfileValues = { ...form.getFieldsValue(true), ...await form.validateFields() };
      if (!task.current() || !currentProfile() || !currentShopAllows(shopId, 'CATALOG_MANAGE')) return;
      const payload = technicianProfilePayload(editing, values);
      const attempt: ProfileAttempt = { id: editing.id, shopId, payload }; profileDraft.current.attempt = attempt;
      dispatched = true;
      const saved = await updateTechnician(editing.id, payload);
      if (!task.current() || !currentProfile()) return;
      if (!profileMatches(saved, attempt)) throw new Error('技师资料回执尚未核对到本次修改。');
      const ok = await editor.load(undefined, false);
      if (!task.current() || !currentProfile()) return;
      const refreshed = editor.getSnapshot(), row = refreshed.snapshot?.therapists.find(person => person.id === editing.id);
      if (!ok || !refreshed.verified || !profileMatches(row, attempt)) throw new Error('最新人员资料尚未核对到本次修改。');
      finishProfile();
    } catch (error) {
      if (!task.current() || !currentProfile() || (error as { errorFields?: unknown })?.errorFields) return;
      const status = (error as { response?: { status?: unknown } })?.response?.status;
      const uncertain = dispatched && !(typeof status === 'number' && [400, 401, 403, 404, 409, 429].includes(status));
      profileDraft.current.unknown = uncertain;
      if (!uncertain) profileDraft.current.attempt = null;
      setProfileUnknown(uncertain); setProfileReviewed(false);
      setFormError(uncertain ? '保存结果尚未确认，草稿已保留。请先重新读取并核对，当前不会重复保存。' : errorMessage(error, '资料保存失败，草稿已保留。'));
    } finally {
      if (task.current()) { writing.current = false; setSaving(false); }
      task.finish();
    }
  };
  const saveCount = () => {
    if (writing.current || dirty || profileDraft.current.unknown || !editable) { message.info('请先保存或关闭个人资料草稿。'); return; }
    setNotice(''); void editor.save();
  };
  const acknowledgeProfileReview = async () => {
    const latest = editor.getSnapshot();
    if (!editing || !shopId || !profileDraft.current.unknown || !profileReviewed || !currentProfile() || writing.current || saving || latest.saving || latest.loading || !latest.verified) return;
    if (!await modal.confirm({ title: '结束本次资料核对？', content: '原修改可能仍会完成，结束不会撤销保存。请先核对刚读取的人员资料；当前草稿会保留供你重新确认后保存。', okText: '已核对，继续编辑', cancelText: '保留核对状态' }) || !currentProfile()) return;
    const refreshed = editor.getSnapshot();
    if (refreshed.snapshot !== latest.snapshot || refreshed.loading || refreshed.saving || !refreshed.verified || writing.current || !profileDraft.current.unknown) return;
    const currentPerson = latest.snapshot?.therapists.find(person => person.id === editing.id && person.shopId === shopId);
    resetProfile();
    if (!currentPerson) {
      setModalOpen(false); setDirty(false); setEditing(null); setFormError(''); form.resetFields();
      setNotice('原人员已不在当前门店，个人资料草稿已结束；未向其他人员保存。');
      return;
    }
    // Keep the operator's form draft, but compare its next explicit save with
    // the verified server values instead of the pre-request profile.
    setEditing(currentPerson);
    setFormError('草稿已保留，并按最新已保存资料重新核对；请确认需要的修改后再保存。');
  };
  const arrange = (person?: StaffMember) => {
    if (!shopId || !exceptions || busy || writing.current || profileDraft.current.unknown || !currentProfile() || state.outcome === 'UNKNOWN') return;
    navigate(person ? reservationEntryHref(shopId, 'therapists', person.id) : `/reservations?shopId=${encodeURIComponent(shopId)}&tab=therapists`);
  };
  const readBack = profileUnknown && profileReviewed && editing ? state.snapshot?.therapists.find(person => person.id === editing.id) : null;
  if (shopLoading) return <Spin style={{ display: 'block', marginTop: 80 }} size="large" />;
  return <>
    {modalContext}
    <PageHeader title="技师管理" description="先设置在岗人数，个人资料和特殊安排按需填写。" />
    {shopError && <Alert style={{ marginBottom: 16 }} type="error" showIcon title={shopError} action={<Button onClick={() => void retry()}>重新核对门店</Button>} />}
    {notice && <Alert style={{ marginBottom: 16 }} type="success" showIcon title={notice} />}
    <StaffingCountPanel state={state} disabled={!shopId || !editable || dirty || profileUnknown || saving} readDisabled={!shopId || saving}
      onChange={value => editor.changeTarget(value)} onSave={saveCount} onRead={() => void refresh()} onReviewed={() => editor.acknowledgeReview()} />
    <Collapse items={[
      { key: 'people', label: '单独编辑技师资料（可选）', children: <>
        <Typography.Paragraph type="secondary">默认名称可直接使用。需要时再填写个人姓名、照片和介绍；已停用人员和原有个人工作时间都会保留。</Typography.Paragraph>
        <TechnicianCards staff={state.snapshot?.therapists ?? []} disabled={!editable || busy || profileUnknown || countDirty || countFrozen || state.loading || !state.verified} onEdit={openEdit} />
      </> },
      { key: 'exceptions', label: '特殊安排（可选）', children: <>
        <Typography.Paragraph>普通技师默认跟随门店营业时间；已有个人安排不变。只有个别技师需要不同班次或请假时，再单独设置。</Typography.Paragraph>
        {exceptions ? <Button disabled={busy || profileUnknown || state.outcome === 'UNKNOWN'} onClick={() => arrange()}>设置个人班次或请假</Button>
          : <Typography.Text type="secondary">特殊班次和请假需要预约设置权限，请联系有权限的管理人员。</Typography.Text>}
      </> },
    ]} />
    <Modal title="编辑个人资料" open={modalOpen} onOk={() => void saveProfile()} onCancel={() => void close()}
      okText="保存资料" confirmLoading={saving} okButtonProps={{ disabled: !dirty || profileUnknown || !editable || state.loading || !state.verified }}
      cancelButtonProps={{ disabled: busy || profileUnknown }} closable={!busy && !profileUnknown} maskClosable={false} width={600}>
      {formError && <Alert style={{ marginBottom: 16 }} type={profileUnknown ? 'warning' : 'error'} showIcon title={formError} />}
      {profileUnknown && <Space wrap style={{ marginBottom: 16 }}>
        <Button loading={state.loading} onClick={() => void refresh()}>重新读取并核对</Button>
        {profileReviewed && state.verified && <Button disabled={busy || state.loading} onClick={acknowledgeProfileReview}>{readBack ? '已核对，继续编辑' : '已核对，关闭草稿'}</Button>}
      </Space>}
      {profileUnknown && profileReviewed && state.verified && <Alert style={{ marginBottom: 16 }} type="info" showIcon title="当前已保存资料"
        description={readBack ? `${staffingDisplayName(readBack.name)}；${readBack.isActive ? '在岗' : '已停用'}；${readBack.title ?? '无头衔'}；${readBack.yearsExp}年经验；简介：${readBack.bio ?? '未填写'}。下方仍是原草稿。` : '原人员已不在本店名单中，请核对后关闭草稿。'} />}
      <Form form={form} layout="vertical" disabled={saving || profileUnknown} onValuesChange={() => setDirty(true)}>
        <Form.Item name="name" label="顾客看到的姓名" rules={[{ required: true, whitespace: true, max: 100, message: '请填写不超过100字的姓名' }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="gender" label="性别（可不填）"><Select allowClear options={GENDERS} /></Form.Item>
        <Collapse items={[
          { key: 'more', label: '照片与介绍（可选）', children: <>
            <Form.Item name="title" label="头衔"><Input /></Form.Item>
            <Form.Item name="yearsExp" label="从业年限"><InputNumber min={0} max={60} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="bio" label="个人简介"><Input.TextArea rows={3} /></Form.Item>
            <Form.Item name="avatar" label="头像地址"><Input placeholder="https://..." /></Form.Item>
          </> },
          { key: 'special', label: '特殊安排（可选）', children: <>
            <Form.Item name="isActive" label="在岗状态" valuePropName="checked"><Switch /></Form.Item>
            <Typography.Paragraph type="secondary">{editing?.scheduleMode === 'CUSTOM' ? '该技师已有个人工作时间，本次编辑资料不会重置。' : '默认跟随门店营业时间。'} 启用后承接本店全部项目。</Typography.Paragraph>
            {exceptions && <Button disabled={busy || dirty || profileUnknown} onClick={() => arrange(editing ?? undefined)}>设置此人的班次或请假</Button>}
          </> },
        ]} />
      </Form>
    </Modal>
  </>;
}

export function TechnicianCoverage({ isActive }: { isActive: boolean }) {
  return <Typography.Text type={isActive ? undefined : 'secondary'}>{isActive ? '本店全部项目（含新增项目）' : '已停用，暂不接待预约'}</Typography.Text>;
}
