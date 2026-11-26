import { durationFieldLabel, durationHelp, serviceKindDraftChange, readServiceDurationKind, serviceDurationLabel, SERVICE_DURATION_LABELS, SERVICE_DURATION_KINDS } from '../../../../src/utils/serviceDuration';
import { displayLabel } from '../../utils/displayLabels';
import { customerSiteOrigin } from '../../../../src/utils/customerSiteUrl';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { createServiceCreateFence } from '../../utils/serviceCreateFence';
import {
  Card,
  Descriptions,
  Table,
  Tag,
  Typography,
  Spin,
  Empty,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Space,
  Popconfirm,
  message,
  Alert,
} from 'antd';
import { CopyOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  getShopServices,
  createService,
  updateService,
  deleteService,
  type ServiceItem,
} from '../../api/merchant';
import { currentShopAllows, isCurrentShop, useShopId } from '../../hooks/useShopId';
import PageHeader from '../../components/PageHeader';
import { useMerchantDraftProtection } from '../../components/MerchantDraftGuard';
import { createCatalogScope } from '../../utils/catalogScope';
import { reservationEntryHref, requestedEntryId } from '../../utils/entryNavigation';
import { errorMessage } from '../../utils/feedback';
import { EMPTY_PROJECT_EDITOR, type EmbeddedProjectEditor } from '../../utils/projectWorkspace';
import { getProjectCatalog } from '../../api/projectCatalog';
import { readProjectCatalogPage, type ProjectCatalogVariant } from '../../../../src/utils/projectCatalog';
import { assertServiceCreateReceipt, assertServiceUpdateReceipt, SERVICE_NAME_LIMIT, serviceDescription, serviceName, servicePriceCents, serviceSavePayload, serviceMetadataPayload } from '../../utils/serviceMenuDraft';

const CATEGORIES = [
  { value: 'MASSAGE', label: '按摩' },
  { value: 'REFLEXOLOGY', label: '足疗' },
  { value: 'CUPPING', label: '拔罐' },
  { value: 'SCRAPING', label: '刮痧' },
  { value: 'HEAD_THERAPY', label: '头疗' },
  { value: 'OTHER', label: '其他' },
];
type EditableProject = Omit<ServiceItem,'category'|'durationKind'|'durationMin'|'priceCents'> & {shopId?:string;category:string|null;durationKind?:string|null;durationMin:number|null;priceCents:number|null};
type ServiceWriteIntent = { serviceId: string; shopId: string; kind: 'edit' | 'status' | 'disable'; payload: Parameters<typeof assertServiceUpdateReceipt>[3] };
const fieldRule = (check: (value: unknown) => unknown) => ({ validator: (_: unknown, value: unknown) => {
  try { check(value); return Promise.resolve(); } catch (e) { return Promise.reject(e); }
} });

export function ServiceProjectEditor(props: EmbeddedProjectEditor) { return <ServicesPage projectEditor={props} />; }

export default function ServicesPage({ projectEditor }: { projectEditor?: EmbeddedProjectEditor } = {}) {
  const { shopId: selectedShopId, shop, loading: shopLoading, refreshing, error: shopError, can, retry } = useShopId();
  const shopId = projectEditor?.shopId ?? selectedShopId;
  const embedded = Boolean(projectEditor);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const requestedServiceId = projectEditor?.serviceId ?? requestedEntryId(params.toString(), 'serviceId');
  const openedTarget = useRef('');
  const [services, setServices] = useState<EditableProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EditableProject | null>(null);
  const [saving, setSaving] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [writeUnknown, setWriteUnknown] = useState(false);
  const unknownRef = useRef(false), writeIntent = useRef<ServiceWriteIntent | null>(null), editorSession = useRef(0);
  const renderedEditorSession = editorSession.current;
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [bookingLinkService, setBookingLinkService] = useState<EditableProject | null>(null);
  const [bookingLinkVariants, setBookingLinkVariants] = useState<ProjectCatalogVariant[]>([]);
  const [bookingLinkLoading, setBookingLinkLoading] = useState(false);
  const bookingLinkRequest = useRef(0);
  const actorId = useAuthStore(state => state.merchant?.id);
  const selectedShopRef = useRef(shopId); selectedShopRef.current = shopId;
  const [creation] = useState(() => createServiceCreateFence({ currentIdentity: () => { const actor = useAuthStore.getState().merchant?.id, currentShop = selectedShopRef.current; return actor && currentShop && isCurrentShop(currentShop) ? { actorId: actor, shopId: currentShop } : null; }, create: createService, verify: assertServiceCreateReceipt }));
  const createState = useSyncExternalStore(creation.subscribe, creation.getSnapshot, creation.getSnapshot);
  const previousIdentity = useRef({ actorId, shopId });
  useLayoutEffect(() => {
    if (previousIdentity.current.actorId !== actorId || previousIdentity.current.shopId !== shopId) {
      scope.dispose(); scope.activate(); locked.current = false; setSaving(false); setChangingId(null); selectionPending.current = false;
      unknownRef.current = false; writeIntent.current = null; editorSession.current++; setWriteUnknown(false);
      setModalOpen(false); setEditing(null); setDirty(false); setNotice(null); setServices([]); setFormError(''); form.resetFields();
      bookingLinkRequest.current++; setBookingLinkService(null); setBookingLinkVariants([]); setBookingLinkLoading(false);
    }
    previousIdentity.current = { actorId, shopId };
    creation.syncIdentity(); return () => creation.dispose();
  }, [creation, actorId, shopId]);
  const createLocked = ['IN_FLIGHT', 'UNKNOWN', 'APPLIED'].includes(createState.state);
  const [form] = Form.useForm();
  const nameValue = Form.useWatch('name', form);
  const durationKind = Form.useWatch('durationKind', form) ?? 'TIMED';
  const [modal, modalContext] = Modal.useModal();
  const [scope] = useState(() => createCatalogScope(() => !!selectedShopRef.current && isCurrentShop(selectedShopRef.current)));
  const locked = useRef(false), selectionPending = useRef(false);
  const busy = saving || changingId !== null;
  const accessReady = !shopLoading && !refreshing && !shopError && can('CATALOG_MANAGE');
  const writeDisabled = busy || loading || createLocked || !accessReady || !!error || !!projectEditor?.disabled || writeUnknown;
  const writable = () => !loading && !projectEditor?.disabled && !unknownRef.current && !!shopId && selectedShopRef.current === shopId
    && useAuthStore.getState().merchant?.id === actorId && scope.current() && currentShopAllows(shopId, 'CATALOG_MANAGE');
  useEffect(() => { projectEditor?.onLifecycleChange({ dirty, busy: busy || modalOpen || loading, unknown: writeUnknown || createState.state === 'UNKNOWN' }); }, [dirty, busy, modalOpen, loading, writeUnknown, createState.state, projectEditor?.onLifecycleChange]);
  useEffect(() => () => { projectEditor?.onLifecycleChange(EMPTY_PROJECT_EDITOR); }, [projectEditor?.onLifecycleChange]);
  useMerchantDraftProtection(shopId ?? '', dirty, busy, () => locked.current || selectionPending.current || unknownRef.current || creation.getSnapshot().state === 'UNKNOWN');

  const fetch = async (signal?: AbortSignal, requireReadback = false) => {
    if (!shopId || !scope.current()) return;
    const current = scope.read();
    setLoading(true);
    try {
      let data: EditableProject[];
      if (projectEditor) {
        const query = { search: '', status: 'all' as const, page: 1, pageSize: 1, serviceId: projectEditor.serviceId };
        const page = readProjectCatalogPage(await getProjectCatalog(shopId, query, signal), shopId, query);
        data = page.items.map(row => ({ id: row.id, shopId: row.shopId, name: row.name, nameEn: row.nameEn, category: row.category,
          durationKind: row.durationKind, durationMin: row.durationMin, priceCents: row.priceCents,
          description: row.description, isActive: row.isActive, hasVariants: row.hasVariants }));
        if(!page.canManageCatalog) throw Error('当前账号只能读取目录，项目资料编辑权限已撤销。');
      } else data = await getShopServices(shopId, signal);
      if (!current()) return;
      setServices(data);
      setError(null);
      return data;
    } catch (e) {
      if (current() && !signal?.aborted) setError(errorMessage(e, '服务项目加载失败'));
      if (requireReadback) throw e;
    } finally {
      if (current()) setLoading(false);
    }
  };

  useEffect(() => {
    scope.activate();
    const controller = new AbortController();
    if (shopId) void fetch(controller.signal);
    return () => { controller.abort(); scope.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, scope, actorId, projectEditor?.serviceId]);

  useEffect(() => { if (projectEditor && !locked.current && !dirty && !modalOpen) void fetch(); }, [projectEditor?.revision]);

  const openEdit = (svc: EditableProject) => {
    if (locked.current || selectionPending.current || createLocked || !writable() || error || projectEditor && !projectEditor.beforeWrite()) return;
    if (typeof svc.hasVariants !== 'boolean') { setError('规格信息尚未核对，请重新加载本店服务后再编辑。'); return; }
    const knownKind = typeof svc.durationKind === 'string' && SERVICE_DURATION_KINDS.some(kind => kind === svc.durationKind) ? readServiceDurationKind(svc.durationKind) : undefined;
    setFormError(''); setDirty(false); form.resetFields();
    editorSession.current++;
    setEditing(svc);
    form.setFieldsValue({
      name: svc.name,
      category: svc.category,
      durationKind: knownKind,
      durationMin: svc.durationMin,
      price: svc.priceCents === null ? null : svc.priceCents / 100,
      description: svc.description || '',
      isActive: svc.isActive,
    });
    setModalOpen(true);
  };

  useEffect(() => {
    if (embedded || !requestedServiceId || loading || !accessReady || error || modalOpen || dirty || busy || locked.current) return;
    const key = actorId + ':' + shopId + ':' + requestedServiceId;
    if (openedTarget.current === key) return;
    const selected = services.find(row => row.id === requestedServiceId);
    if (!selected) return;
    openedTarget.current = key; openEdit(selected);
  }, [embedded, requestedServiceId, services, loading, accessReady, error, modalOpen, dirty, busy, actorId, shopId]);

  const handleSave = async () => {
    if (locked.current || selectionPending.current || createLocked || !modalOpen || renderedEditorSession !== editorSession.current || !writable() || error || projectEditor && !projectEditor.beforeWrite()) return;
    const task = scope.beginWrite();
    if (!task) return;
    locked.current = true;
    setSaving(true);
    setFormError('');
    let submitted = false, persisted = false;
    try {
      const values = await form.validateFields();
      if (!task.current() || !writable() || projectEditor && !projectEditor.beforeWrite()) return;
      let saved: ServiceItem;
      if (editing) {
        const payload = editing.hasVariants ? serviceMetadataPayload(values) : serviceSavePayload(values, 'EDIT');
        writeIntent.current = { serviceId: editing.id, shopId: shopId!, kind: 'edit', payload };
        submitted = true;
        saved = await updateService(editing.id, payload);
        assertServiceUpdateReceipt(saved, editing.id, shopId!, payload);
      } else {
        await creation.submit(serviceSavePayload(values, 'NEW'));
        const outcome = creation.getSnapshot();
        if (!task.current()) return;
        if (outcome.state !== 'APPLIED' || !outcome.result) { setFormError(outcome.error || '保存结果尚未确认，请核对列表。'); return; }
        saved = outcome.result;
      }
      persisted = true;
      if (!task.current()) return;
      setServices(previous => editing ? previous.map(row => row.id === saved.id ? saved : row) : [...previous, saved]);
      const latest = await fetch(undefined, true);
      if (editing && task.current()) assertServiceUpdateReceipt(latest?.find(row => row.id === editing.id), editing.id, shopId!, writeIntent.current!.payload);
      if (projectEditor && task.current()) await projectEditor.onSaved();
      if (!task.current()) return;
      setNotice({ id: String(saved.id), text: editing ? '本服务共同资料已更新，并已重新读取目录与关联展示行。' : '服务已创建，并已重新读取本店目录。' });
      writeIntent.current = null; editorSession.current++; setModalOpen(false); setDirty(false);
      if (!editing) { creation.finish(); form.resetFields(); }
    } catch (e: any) {
      if (task.current() && !e?.errorFields) {
        setFormError(errorMessage(e, '服务保存失败，草稿已保留。'));
        if (submitted && (persisted || !e?.response?.status || e.response.status >= 500 || e.response.status === 408)) { unknownRef.current = true; setWriteUnknown(true); }
        else writeIntent.current = null;
      }
    } finally {
      if (task.current()) { locked.current = false; setSaving(false); }
      task.finish();
    }
  };

  const close = async () => {
    if (locked.current || selectionPending.current || busy || unknownRef.current) return;
    if (creation.getSnapshot().state === 'UNKNOWN') { setModalOpen(false); return; }
    if (creation.getSnapshot().state === 'APPLIED') { creation.finish(); setModalOpen(false); setDirty(false); form.resetFields(); return; }
    const requestActor = actorId, requestShop = shopId;
    if (dirty && !await modal.confirm({ title: '放弃尚未保存的服务修改？', content: '当前表单尚未保存。', okText: '放弃', cancelText: '继续编辑' })) return;
    if (useAuthStore.getState().merchant?.id === requestActor && selectedShopRef.current === requestShop && !locked.current && !selectionPending.current && scope.current()) { editorSession.current++; setModalOpen(false); setDirty(false); }
  };

  const finishUnknown = async () => {
    const original = creation.getSnapshot(), requestActor = actorId, requestShop = shopId;
    if (locked.current || original.state !== 'UNKNOWN') return;
    if (!await modal.confirm({ title: '明确结束此未知草稿？', content: '原请求可能已成功或稍后完成；结束草稿不会取消保存。请先只读核对列表，即使暂时没有匹配项也不能认定未创建。结束并丢弃此草稿后，才可明确另建。', okText: '结束未知草稿', cancelText: '继续核对' })) return;
    if (useAuthStore.getState().merchant?.id !== requestActor || selectedShopRef.current !== requestShop || creation.getSnapshot() !== original || !scope.current() || !creation.finish(true)) return;
    setModalOpen(false); setDirty(false); setFormError(''); form.resetFields();
  };

  const recoverWrite = async (discard = false) => {
    const intent = writeIntent.current;
    if (!intent || !unknownRef.current || locked.current || selectionPending.current || !scope.current()
      || selectedShopRef.current !== shopId || useAuthStore.getState().merchant?.id !== actorId || !currentShopAllows(intent.shopId, 'CATALOG_MANAGE')) return;
    const task = scope.beginWrite();
    if (!task) return;
    locked.current = true; setSaving(true);
    try {
      if (discard && !await modal.confirm({ title: '结束未知草稿并重新核对项目？', content: '原请求不会取消，也可能稍后完成。当前输入将放弃，请核对最新目录；未找到变化也不能证明原请求未保存。', okText: '结束草稿并核对', cancelText: '保留草稿' })) return;
      if (!task.current() || writeIntent.current !== intent) return;
      const latest = await fetch(undefined, true);
      if (!task.current() || writeIntent.current !== intent) return;
      if (!discard) assertServiceUpdateReceipt(latest?.find(row => row.id === intent.serviceId), intent.serviceId, intent.shopId, intent.payload);
      if (projectEditor) await projectEditor.onSaved();
      if (!task.current() || writeIntent.current !== intent) return;
      unknownRef.current = false; writeIntent.current = null; setWriteUnknown(false); setFormError('');
      editorSession.current++; setModalOpen(false); setDirty(false);
      if (discard) form.resetFields();
      else setNotice({ id: intent.serviceId, text: '已只读核对本次项目保存结果，未再次提交。' });
    } catch (cause) {
      if (task.current()) setFormError(errorMessage(cause));
    } finally {
      if (task.current()) { locked.current = false; setSaving(false); }
      task.finish();
    }
  };
  const unknownAlert = writeUnknown && <Alert style={{ marginBottom: 16 }} type="warning" showIcon title="保存结果未知，当前项目写入已锁定"
    description="原请求可能已保存或稍后完成。只读核对会检查本次提交的项目与内容；未一致时保留草稿，不会自动重试。"
    action={<Space wrap><Button loading={saving} disabled={busy || loading || !accessReady} onClick={() => void recoverWrite()}>只读核对本次保存结果</Button>
      <Button disabled={busy || loading || !accessReady} onClick={() => void recoverWrite(true)}>结束草稿并核对</Button></Space>} />;

  const handleDelete = async (id: string) => {
    if (locked.current || selectionPending.current || createLocked || !writable() || error) return;
    const task = scope.beginWrite();
    if (!task) return;
    locked.current = true;
    setChangingId(id);
    const intent: ServiceWriteIntent = { serviceId: id, shopId: shopId!, kind: 'disable', payload: { isActive: false } };
    writeIntent.current = intent;
    let persisted = false;
    try {
      await deleteService(id);
      persisted = true;
      if (!task.current()) return;
      const latest = await fetch(undefined, true);
      if (!task.current()) return;
      assertServiceUpdateReceipt(latest?.find(row => row.id === id), id, shopId!, intent.payload);
      writeIntent.current = null;
      message.success('服务已停用');
    } catch (e: any) {
      if (task.current()) {
        message.error(errorMessage(e, '服务停用失败'));
        if (persisted || !e?.response?.status || e.response.status >= 500 || e.response.status === 408) { unknownRef.current = true; setWriteUnknown(true); }
        else writeIntent.current = null;
      }
    } finally { if (task.current()) { locked.current = false; setChangingId(null); } task.finish(); }
  };

  const setActive = async (record: EditableProject, active: boolean) => {
    if (locked.current || selectionPending.current || createLocked || !writable() || error) return;
    const task = scope.beginWrite();
    if (!task) return;
    locked.current = true;
    setChangingId(record.id);
    const intent: ServiceWriteIntent = { serviceId: record.id, shopId: shopId!, kind: 'status', payload: { isActive: active } };
    writeIntent.current = intent;
    let persisted = false;
    try {
      const saved = await updateService(record.id, intent.payload);
      persisted = true;
      assertServiceUpdateReceipt(saved, record.id, shopId!, intent.payload);
      if (!task.current()) return;
      const latest = await fetch(undefined, true);
      if (!task.current()) return;
      assertServiceUpdateReceipt(latest?.find(row => row.id === record.id), record.id, shopId!, intent.payload);
      writeIntent.current = null;
      message.success(active ? '服务已启用' : '服务已停用');
    } catch (error: any) {
      if (task.current()) {
        message.error(errorMessage(error, '无法更新服务状态'));
        if (persisted || !error?.response?.status || error.response.status >= 500 || error.response.status === 408) { unknownRef.current = true; setWriteUnknown(true); }
        else writeIntent.current = null;
      }
    } finally { if (task.current()) { locked.current = false; setChangingId(null); } task.finish(); }
  };

  const copyBookingLink = async (record: EditableProject, variantId?: string) => {
    if (!shopId || !shop || !isCurrentShop(shopId) || !record.isActive) return;
    if (shop.features?.onlineBooking !== true) { message.error('本店尚未开启线上预约，当前链接无法下单。'); return; }
    const path = shop.canonicalPath;
    if (typeof path !== 'string' || !/^\/s\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)) { message.error('当前门店尚无有效公开短链。'); return; }
    const active = scope.capture(), request = ++bookingLinkRequest.current;
    const current = () => active() && request === bookingLinkRequest.current;
    if (!current()) return;
    setBookingLinkLoading(true);
    try {
      const query = { search: '', status: 'all' as const, page: 1, pageSize: 1, serviceId: record.id };
      const catalog = readProjectCatalogPage(await getProjectCatalog(shopId, query), shopId, query);
      if (!current()) return;
      const item = catalog.items.find(row => row.id === record.id && row.shopId === shopId);
      if (!catalog.canManageCatalog || !item || !item.isActive || !isCurrentShop(shopId)) throw Error('项目授权或状态已变化，请刷新后重试。');
      const durationKinds = ['TIMED', 'PER_SESSION', 'VARIABLE'];
      const serviceShapeValid = durationKinds.includes(String(item.durationKind))
        && [1, 2].includes(item.participantCount ?? 0)
        && [1, 2].includes(item.requiredStaffCount ?? 0)
        && (item.requiredStaffCount ?? 0) >= (item.participantCount ?? 0);
      if (!serviceShapeValid) throw Error('此项目预约规则尚未完整配置，暂不能生成预约直达链接。');
      const eligibleVariants = item.variants.filter(variant => variant.isActive
        && variant.currency === 'usd' && ['PER_PERSON', 'PER_BOOKING'].includes(String(variant.priceBasis))
        && Number.isInteger(variant.durationMin) && variant.durationMin! >= 5 && variant.durationMin! <= 240
        && Number.isInteger(variant.priceCents) && variant.priceCents! > 0);
      if (item.hasVariants) {
        if (!eligibleVariants.length) throw Error('此服务没有启用且符合预约条件的规格。');
        if (!variantId) { setBookingLinkService(record); setBookingLinkVariants(eligibleVariants); return; }
        if (!eligibleVariants.some(variant => variant.id === variantId)) throw Error('该规格已停用或不符合预约条件，请刷新后重试。');
      } else if (variantId || !Number.isInteger(item.durationMin) || item.durationMin! < 5 || item.durationMin! > 240
        || !Number.isInteger(item.priceCents) || item.priceCents! <= 0 || !['PER_PERSON', 'PER_BOOKING'].includes(String(item.priceBasis))) {
        throw Error('此项目预约时间或价格尚未完整配置，暂不能生成预约直达链接。');
      }
      const url = new URL(path, customerSiteOrigin(window.location.origin));
      url.searchParams.set('serviceId', record.id);
      if (variantId) url.searchParams.set('variantId', variantId);
      await navigator.clipboard.writeText(url.toString());
      if (current()) { setBookingLinkService(null); setBookingLinkVariants([]); message.success('顾客预约直达链接已复制。'); }
    } catch (cause) { if (current()) message.error(errorMessage(cause, '无法生成预约直达链接')); }
    finally { if (current()) setBookingLinkLoading(false); }
  };

  const columns: ColumnsType<EditableProject> = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '项目时长类型', dataIndex: 'durationKind', key: 'durationKind', render: (kind: unknown) => SERVICE_DURATION_LABELS[readServiceDurationKind(kind)] },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      render: (v: string) => <Tag>{displayLabel(v)}</Tag>,
    },
    {
      title: '服务时长／预约预留',
      dataIndex: 'durationMin',
      key: 'durationMin',
      render: (v: number | null, row: EditableProject) => {
        if (row.hasVariants === true) return '以所选规格为准';
        if (row.hasVariants !== false) return '规格待核对';
        if (v === null || !Number.isSafeInteger(v) || v <= 0) return '时长待核对';
        try { return serviceDurationLabel(row.durationKind, v); } catch { return '时长类型待核对'; }
      },
    },
    {
      title: '价格',
      dataIndex: 'priceCents',
      key: 'priceCents',
      render: (v: number | null, row: EditableProject) => row.hasVariants === true ? '按规格定价' : row.hasVariants !== false ? '规格待核对' : v === null || !Number.isSafeInteger(v) || v <= 0 ? '价格待核对' : `$${(v / 100).toFixed(2)}`,
    },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '已启用',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (v: boolean, record: EditableProject) => <Switch checked={v}
        checkedChildren="已启用" unCheckedChildren="已停用"
        loading={changingId === record.id} disabled={writeDisabled}
        onChange={(active) => void setActive(record, active)} />,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: EditableProject) => (
        <Space wrap>
          <Button size="small" disabled={writeDisabled} onClick={() => openEdit(record)}>
            编辑
          </Button>
          {can('RESERVATION_CONFIG') && <Link to={reservationEntryHref(shopId!, 'services', record.id)}><Button size="small" disabled={busy}>规格与规则</Button></Link>}
          <Button size="small" icon={<CopyOutlined />} disabled={writeDisabled || !record.isActive || shop?.features?.onlineBooking !== true || !shop?.canonicalPath} onClick={() => void copyBookingLink(record)}>复制预约直达链接</Button>
          <Popconfirm title="停用该服务？" description="现有预约保留，可通过状态开关重新启用。" onConfirm={() => handleDelete(record.id)}>
          <Button
            size="small"
            danger
            disabled={writeDisabled || !record.isActive}
          >
            停用
          </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (!modalOpen && !writeUnknown && (shopLoading || (loading && !error))) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!modalOpen && !writeUnknown && !createLocked && (shopError || error)) {
    return <Alert type="error" showIcon message={shopError || error || '服务项目加载失败'} action={shopId ? <Button onClick={() => void fetch()}>重试</Button> : undefined} />;
  }

  return (
    <>
      {modalContext}
      {embedded ? <Card title="服务共同资料" extra={<Button disabled={writeDisabled || !services.some(row => row.id === requestedServiceId)} onClick={() => { const selected = services.find(row => row.id === requestedServiceId); if (selected) openEdit(selected); }}>编辑服务共同资料</Button>}>
        {services.find(row => row.id === requestedServiceId) ? <Descriptions column={{ xs: 1, sm: 2 }} items={[
          { key: 'name', label: '主项目名称', children: services.find(row => row.id === requestedServiceId)!.name },
          { key: 'status', label: '状态', children: services.find(row => row.id === requestedServiceId)!.isActive ? '已启用' : '已停用' },
          { key: 'category', label: '分类', children: displayLabel(services.find(row => row.id === requestedServiceId)!.category) },
        ]} /> : <Alert type="warning" showIcon title="未找到所选本店项目，请重新选择；不会替换成其他项目。" />}
        <Typography.Paragraph type="secondary">只保存本服务名称、分类、说明与启停，并同步关联展示行；下方“规格与价格”单独保存各规格。其他服务与历史订单不随本表单改动。</Typography.Paragraph>
      </Card> : <>
      <PageHeader title="服务管理" description="在价目与预约项目中维护名称、价格和时长；这里管理主项目资料、启停和实际规格。" actions={<Space wrap>{can('RESERVATION_CONFIG') && <Link to="/reservations?tab=services"><Button disabled={busy}>规格与预约规则</Button></Link>}<Button disabled={writeDisabled} type="primary" icon={<PlusOutlined />} onClick={() => { if (!writeDisabled && shopId) navigate('/price-menu?' + new URLSearchParams({ shopId })); }}>
          新增服务
        </Button></Space>} />
      {!accessReady && <Alert style={{ marginBottom: 16 }} type="warning" showIcon title={refreshing ? '正在核对本店权限，草稿保留，暂不可保存。' : shopError || '本店服务编辑权限已撤销，当前草稿保留为只读。'} />}
      {createState.state === 'UNKNOWN' && <Alert style={{ marginBottom: 16 }} type="warning" showIcon title="新建结果未知，当前草稿已锁定" description="原请求可能已成功或稍后完成；不会再次提交。请只读核对列表，暂时无匹配项也不能证明未创建。关闭窗口不取消保存。" action={<Space wrap><Button loading={loading} disabled={!accessReady || busy} onClick={() => void fetch()}>只读刷新列表核对</Button><Button onClick={() => setModalOpen(true)}>查看锁定草稿</Button><Button disabled={busy} onClick={() => void finishUnknown()}>明确结束未知草稿</Button></Space>} />}
      {createState.state === 'APPLIED' && <Alert style={{ marginBottom: 16 }} type="success" showIcon title="本次创建回执已核对" description="当前结果已保存，完成此结果后可明确另建。" action={<Button onClick={() => { if (creation.finish()) { setModalOpen(false); setDirty(false); } }}>完成此结果</Button>} />}
      {notice && <Alert style={{ marginBottom: 16 }} type="success" showIcon title={notice.text} action={can('RESERVATION_CONFIG') ? <Link to={reservationEntryHref(shopId!, 'services', notice.id)}><Button>配置该服务</Button></Link> : undefined} />}
      <Alert style={{ marginBottom: 16 }} type="info" showIcon title="基础服务目录" description="独立规格价格、时长与单人／双人规则在预约设置中管理。已有规格时，顾客必须选择启用规格；此处基础价格不代表规格价格。" />

      {services.length === 0 ? (
        <Card>
          <Empty description="暂无服务，请点击“新增服务”创建。" />
        </Card>
      ) : (
        <Table<EditableProject>
          dataSource={services}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ x: 1000 }}
        />
      )}

      </>}

      {!modalOpen && unknownAlert}
      {!modalOpen && writeUnknown && formError && <Alert style={{ marginBottom: 16 }} type="error" showIcon title={formError} />}

      <Modal
        title={editing ? '编辑服务' : '新增服务'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => void close()}
        confirmLoading={saving}
        okButtonProps={{ disabled: writeDisabled }}
        cancelButtonProps={{ disabled: busy }}
        closable={!busy}
        maskClosable={false}
        okText={editing ? '保存本服务共同资料' : '创建服务'}
        styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }}
      >
        {modalOpen && unknownAlert}
        {!accessReady && <Alert style={{ marginBottom: 16 }} type="warning" showIcon title={refreshing ? '正在核对权限，当前表单只读。' : shopError || '编辑权限已撤销，草稿保留，保存已禁用。'} action={shopError ? <Button disabled={busy} onClick={() => void retry()}>重新核对权限</Button> : undefined} />}
        {error && <Alert style={{ marginBottom: 16 }} type="error" showIcon title={error} action={<Button loading={loading} disabled={busy} onClick={() => void fetch()}>刷新服务列表核对</Button>} />}
        {formError && <Alert style={{ marginBottom: 16 }} type="error" showIcon title={formError} description={createState.state === 'UNKNOWN' ? '当前草稿已锁定，请只读核对列表，不要重复创建。' : '草稿已保留，请检查表单或明确的拒绝原因。'} />}
        {!editing && <Typography.Paragraph><Link to={`/price-menu?shopId=${encodeURIComponent(shopId ?? '')}`}>在价目与预约项目中直接配置</Link>；名称、价格和时长只维护一次，不再复制成独立服务。</Typography.Paragraph>}
        {typeof nameValue === 'string' && nameValue.length > SERVICE_NAME_LIMIT && <Alert style={{ marginBottom: 16 }} type="warning" showIcon title={`当前名称 ${nameValue.length} 字，服务名称最多 200 字。`} description="来源名称已完整保留，系统不会静默截断；请手动修改后再保存。" />}
        <Form
          form={form}
          layout="vertical"
          initialValues={{ category: 'MASSAGE', durationKind: 'TIMED', isActive: true }}
          disabled={writeDisabled}
          onValuesChange={changed => { setDirty(true); if (Object.hasOwn(changed, 'durationKind')) form.setFieldsValue(serviceKindDraftChange(changed.durationKind, Boolean(editing))); }}
        >
          <Form.Item
            name="name"
            label="服务名称"
            rules={[fieldRule(serviceName)]}
          >
            <Input maxLength={typeof nameValue === 'string' && nameValue.length > SERVICE_NAME_LIMIT ? undefined : SERVICE_NAME_LIMIT} showCount />
          </Form.Item>
          {!editing?.hasVariants && <Form.Item name="durationKind" label="项目时长类型" rules={[{ required: true }]}><Select options={SERVICE_DURATION_KINDS.map(value => ({ value, label: SERVICE_DURATION_LABELS[value] }))} /></Form.Item>}
          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select options={CATEGORIES} />
          </Form.Item>
          {!editing?.hasVariants && <><Form.Item
            name="durationMin"
            label={durationFieldLabel(durationKind)}
            extra={durationHelp(durationKind)}
            rules={[{ required: true, type: 'integer', min: 5, max: 240, message: '请人工填写 5 至 240 的整数分钟时长／预约预留时间' }]}
          >
            <InputNumber min={5} max={240} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="price"
            label="价格（美元）"
            rules={[fieldRule(servicePriceCents)]}
          >
            <InputNumber
              min={0}
              max={999999.99}
              precision={2}
              prefix="$"
              style={{ width: '100%' }}
            />
          </Form.Item>
          </>}
          {editing?.hasVariants && <Alert type="info" showIcon title="本项目按规格定价" description="此处只修改主项目资料和启停；时长与价格请在规格与规则中修改。" />}
          <Form.Item name="description" label="说明" rules={[fieldRule(serviceDescription)]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          {editing ? <Form.Item name="isActive" label="已启用" valuePropName="checked">
              <Switch />
            </Form.Item> : <Typography.Paragraph type="secondary">手动新建服务默认启用，创建后可在价目中关联。</Typography.Paragraph>}
        </Form>
      </Modal>
      <Modal title={`复制预约直达链接 · ${bookingLinkService?.name ?? ''}`} open={!!bookingLinkService} onCancel={() => { bookingLinkRequest.current++; setBookingLinkService(null); setBookingLinkVariants([]); setBookingLinkLoading(false); }} footer={null} destroyOnHidden>
        <Typography.Paragraph type="secondary">请选择一个当前启用的服务规格。链接只会预选该规格，不会绕过门店时段、技师或场地检查。</Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>{bookingLinkVariants.map(variant => <Button key={variant.id} block loading={bookingLinkLoading} disabled={bookingLinkLoading} onClick={() => { if (bookingLinkService) void copyBookingLink(bookingLinkService, variant.id); }}>{variant.name} · {variant.durationMin} 分钟 · ${((variant.priceCents ?? 0) / 100).toFixed(2)}</Button>)}</Space>
      </Modal>
    </>
  );
}
