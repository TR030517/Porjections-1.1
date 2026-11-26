import { readServiceDurationKind, SERVICE_DURATION_LABELS } from '../../../src/utils/serviceDuration';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Select, Space, Table, Tag, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { getCopyHistory, previewCopy, type CopyHistory, type CopyKind as Kind, type CopyPreview as Preview, type AddOnCopyChange } from '../api/accountAccess';
import { useShopId } from '../hooks/useShopId';
import { errorMessage } from '../utils/feedback';
import { useAuthStore } from '../stores/authStore';
import { beginRecoverableCopy, checkRecoverableCopy, finishRecoverableCopy, retryRecoverableCopy, useCopyRecoveryStore } from '../stores/copyRecoveryStore';
import { formatBusinessHours } from '../utils/reservationHours';
import { canCopyKind, copyKindPermissionMessage, copyKindSelection, requestedEntryId, resolveCopyEntry } from '../utils/entryNavigation';
import type { PriceMenuGroup } from '../../../src/utils/priceMenu';
import PriceMenuPreview from '../../../src/components/store/PriceMenuPreview';
import CopyMenuLinks from '../../../src/components/store/CopyMenuLinks';

// Each side is keyed by signed preview + from/to below. A new preview resets
// viewing state; expanding a side never edits the complete signed changes.
function MenuSummary({ value }: { value: PriceMenuGroup[] }) {
  const count = value.reduce((sum, group) => sum + group.items.length, 0);
  return <div style={{ overflowWrap: 'anywhere', marginTop: 8 }}>
    <Typography.Paragraph type="secondary">共 {value.length} 个分组 · {count} 个项目 · 只读预览</Typography.Paragraph>
    <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>分批查看仅改变显示范围，确认时仍应用完整价目。</Typography.Paragraph>
    <PriceMenuPreview value={value} language="zh" showImages={false} />
  </div>;
}

const kindLabels: Record<Kind, string> = { HOURS: '营业时间', PRICE_MENU: '项目与价目（含预约关联）', CATALOG: '旧版目录复制记录', ADD_ONS: '附加项目（只加价，不加时）' };
const addOnReasons = { NEW: '精确匹配主服务，新增停用副本', MAIN_NOT_FOUND: '目标店缺少对应主服务，请先复制项目与价目', AMBIGUOUS_MAIN: '来源或目标主服务匹配不唯一，请先整理', DUPLICATE_SOURCE_NAME: '来源同一主服务下存在同名附加项目', TARGET_NAME_EXISTS: '目标同一主服务下已有同名项目，保留原配置', TARGET_LIMIT: '目标主服务已有或拟有50条，达到容量上限' };

export function AddOnCopySummary({ rows }: { rows: AddOnCopyChange[] }) {
  const created = rows.filter(row => row.action === 'CREATE').length;
  return <div style={{ marginTop: 16, minWidth: 0 }}>
    <Typography.Paragraph>共 {rows.length} 条来源附加配置；拟新增 {created} 条（全部默认停用），跳过 {rows.length - created} 条。</Typography.Paragraph>
    <Typography.Paragraph type="secondary">按主服务名称、分类、人数、价格口径与时长类型精确匹配；同名不同类型不匹配，不猜测父项、不覆盖原配置。每页最多20条；确认应用完整签名计划，包含所有页。</Typography.Paragraph>
    {rows.length === 0 ? <Typography.Paragraph>来源门店没有可复制的附加项目。</Typography.Paragraph> : <Table<AddOnCopyChange>
      rowKey="sourceId" size="small" dataSource={rows} scroll={{ x: 1100 }}
      pagination={{ pageSize: 20, showSizeChanger: false, showTotal: total => `共 ${total} 条附加项目计划` }} columns={[
        { title: '来源主服务', width: 180, render: (_: unknown, row) => <span>{row.sourceServiceName}<br /><Tag color="cyan">{SERVICE_DURATION_LABELS[readServiceDurationKind(row.sourceDurationKind)]}</Tag><br /><Typography.Text type="secondary">#{row.sourceServiceId}</Typography.Text></span> },
        { title: '精确匹配的目标主服务', width: 180, render: (_: unknown, row) => row.targetServiceId === null ? <Typography.Text type="secondary">未指定目标主服务</Typography.Text> : <span>{row.targetServiceName}<br /><Tag color="cyan">{SERVICE_DURATION_LABELS[readServiceDurationKind(row.targetDurationKind)]}</Tag><br /><Typography.Text type="secondary">#{row.targetServiceId}</Typography.Text></span> },
        { title: '附加项目', width: 180, render: (_: unknown, row) => <div style={{ overflowWrap: 'anywhere' }}><strong>{row.name}</strong>{row.description && <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{row.description}</p>}</div> },
        { title: '明确价格', width: 110, render: (_: unknown, row) => `USD ${(row.priceCents / 100).toFixed(2)}` },
        { title: '来源状态', width: 100, render: (_: unknown, row) => <Tag color={row.sourceActive ? 'cyan' : 'default'}>{row.sourceActive ? '已启用' : '已停用'}</Tag> },
        { title: '目标操作', width: 160, render: (_: unknown, row) => row.action === 'CREATE' ? '新增独立副本（默认停用）' : '跳过，不改目标' },
        { title: '原因', width: 240, render: (_: unknown, row) => <div style={{ overflowWrap: 'anywhere' }}>{addOnReasons[row.reasonCode]}<p className="merchant-secondary" style={{ margin: '4px 0' }}>{row.reason}</p></div> },
      ]} />}
  </div>;
}

export default function CopyConfigPanel() {
  const { shops, shopId, loading, refreshing, error: accessError } = useShopId();
  const [params] = useSearchParams();
  const requestedSource = requestedEntryId(params.toString(), 'sourceShopId');
  const entry = resolveCopyEntry(shops, requestedSource, shopId);
  const actor = useAuthStore(state => state.merchant?.id);
  const stored = useCopyRecoveryStore(state => state.operation);
  const storageWarning = useCopyRecoveryStore(state => state.storageWarning);
  const operation = stored?.actorId === actor ? stored : null;
  const [source, setSource] = useState(operation?.input.sourceShopId ?? entry.sourceId), [target, setTarget] = useState(operation?.input.targetShopId ?? ''), [kind, setKind] = useState<Kind>(() => operation?.input.kind ?? entry.kind);
  const [entryError, setEntryError] = useState(entry.error);
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(''), [previewBusy, setPreviewBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [previewActor, setPreviewActor] = useState<string | undefined>(undefined);
  const [historyOwner, setHistoryOwner] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<CopyHistory | null>(null), [historyPage, setHistoryPage] = useState(1), [historyRevision, setHistoryRevision] = useState(0), [historyBusy, setHistoryBusy] = useState(false), [historyError, setHistoryError] = useState('');
  const alive = useRef(true), pending = useRef<AbortController | null>(null), version = useRef(0), lock = useRef(false), contextKey = useRef('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; version.current++; pending.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(), requestActor = actor; setHistory(null); setHistoryError(''); setHistoryOwner(requestActor);
    if (!requestActor || loading || refreshing || accessError) { setHistoryBusy(false); return () => controller.abort(); }
    setHistoryBusy(true);
    const current = () => !controller.signal.aborted && useAuthStore.getState().merchant?.id === requestActor;
    getCopyHistory(historyPage, 20, controller.signal).then(data => { if (current()) setHistory(data); }).catch(err => { if (current()) setHistoryError(errorMessage(err)); }).finally(() => { if (current()) setHistoryBusy(false); });
    return () => controller.abort();
  }, [actor, historyPage, historyRevision, operation?.result?.operationId, loading, refreshing, accessError]);
  const reset = () => { version.current++; pending.current?.abort(); lock.current = false; setPreviewBusy(false); setPreview(null); setPreviewActor(undefined); setError(''); setConfirmed(false); };
  useEffect(() => {
    reset();
    if (loading || refreshing) return;
    const key = JSON.stringify([actor, shopId, requestedSource]), next = resolveCopyEntry(shops, requestedSource, shopId);
    if (operation) {
      setSource(operation.input.sourceShopId); setTarget(operation.input.targetShopId); setKind(operation.input.kind); setEntryError('');
    } else if (contextKey.current !== key) {
      setSource(next.sourceId); setTarget(''); setKind(next.kind); setEntryError(next.error);
    } else {
      const selected = copyKindSelection(shops, source, target, kind);
      setSource(selected.sourceId); setTarget(selected.targetId);
      if (source && !selected.sourceId) setEntryError('原来源门店已不具备本类型的完整复制权限，请重新选择。');
    }
    contextKey.current = key;
  }, [actor, shopId, requestedSource, operation?.idempotencyKey, loading, refreshing, shops]);
  const eligible = shops.filter(shop => canCopyKind(shop, kind));
  const valid = !loading && !refreshing && !accessError && source !== target && eligible.some(shop => shop.id === source) && eligible.some(shop => shop.id === target);
  const busy = refreshing || previewBusy || operation?.state === 'IN_FLIGHT' || operation?.state === 'CHECKING';
  const locked = busy || Boolean(operation);
  const terminal = Boolean(operation && ['APPLIED', 'REJECTED', 'NOT_APPLIED'].includes(operation.state));
  const shownPreview = operation && !['APPLIED', 'REJECTED', 'NOT_APPLIED'].includes(operation.state) ? operation.preview : previewActor === actor && !loading && !refreshing && !accessError ? preview : null;
  const result = operation?.result;
  const displaySource = operation?.input.sourceShopId ?? source, displayTarget = operation?.input.targetShopId ?? target;
  const requestPreview = async () => {
    if (lock.current || operation || !valid) return;
    const current = version.current, requestActor = actor, controller = new AbortController(); pending.current = controller; lock.current = true; setPreviewBusy(true); setError('');
    try {
      const data = await previewCopy({ sourceShopId: source, targetShopId: target, kind }, controller.signal);
      if (alive.current && version.current === current && useAuthStore.getState().merchant?.id === requestActor && !useCopyRecoveryStore.getState().operation) { setPreview(data); setPreviewActor(requestActor); setConfirmed(false); }
    } catch (err) { if (alive.current && version.current === current && !controller.signal.aborted) setError(errorMessage(err)); }
    finally { if (alive.current && version.current === current) { lock.current = false; setPreviewBusy(false); } }
  };
  const apply = async () => {
    try {
      if (useAuthStore.getState().merchant?.id !== actor) return;
      if (operation?.state === 'UNKNOWN') await retryRecoverableCopy();
      else if (!operation && valid && previewActor === actor && preview && confirmed) await beginRecoverableCopy({ sourceShopId: source, targetShopId: target, kind }, preview);
    } catch (err) { if (alive.current) setError(errorMessage(err)); }
  };
  const name = (id: string) => shops.find(shop => shop.id === id)?.name ?? `门店编号 #${id}`;
  const finish = () => { try { finishRecoverableCopy(); reset(); if (kind === 'CATALOG') { setKind('PRICE_MENU'); const selected = copyKindSelection(shops, source, '', 'PRICE_MENU'); setSource(selected.sourceId); setTarget(''); } } catch (err) { setError(errorMessage(err)); } };
  const check = async () => { try { await checkRecoverableCopy(); } catch (err) { if (alive.current) setError(errorMessage(err)); } };
  return <div className="merchant-page"><Typography.Title level={4}>复制门店设置</Typography.Title>
    <Alert type="info" showIcon title="每次确认仅复制到一家目标门店" description="项目与价目统一复制并保留预约关联，系统自动映射目标服务与规格，无须再单独复制目录。新建资源全部停用，已有目标配置保留启停；同名规则冲突需先整理。价目已关联的附加项目一起复制，其他附加项目可单独复制。营业时间独立配置。来源专属图片须重新上传；不会开启在线预约或账号，地址、人员与历史订单保留。" />
    {accessError && <Alert type="error" title={accessError} />}
    {!loading && entryError && <Alert type="warning" showIcon title={entryError} description="打开链接不会授予权限或执行复制，也不会自动换成其他来源门店。" />}
    {operation && <Card title={operation.restored && !terminal ? '已恢复原操作，结果尚未确认' : '原操作'}><Descriptions column={1} size="small" items={[
      { key: 'source', label: '原来源门店', children: `${name(operation.input.sourceShopId)} · #${operation.input.sourceShopId}` },
      { key: 'target', label: '原目标门店', children: `${name(operation.input.targetShopId)} · #${operation.input.targetShopId}` },
      { key: 'kind', label: '配置', children: kindLabels[operation.input.kind] },
      { key: 'context', label: '当前工作区', children: shopId ? `${name(shopId)} · #${shopId}` : '尚未选择门店' },
    ]} /><Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>在同一标签页中切换页面、门店或刷新时，会为当前账号保留最小核对标识；恢复不会自动复制或重试，不保存预览明细。退出或切换账号会清除恢复标识，近期成功记录仍按当前权限显示。</Typography.Paragraph></Card>}
    {storageWarning && <Alert type="warning" showIcon title="复制恢复标识需要处理" description={<><p>{storageWarning}</p><p style={{ marginBottom: 0 }}>{terminal ? '结果继续保留，清理恢复标识成功后才能关闭此记录并开始下一次复制。请重试安全清理；不要把存储清理失败当成复制失败。' : operation ? '请保留此记录，继续核对原请求；不会因存储异常改成另一笔复制。' : '首次复制只有在最小恢复标识成功保存后才会发送。存储失败会拒绝本次复制，不会降级为仅在内存提交。'}</p></>} />}
    <Card title="选择来源与目标"><Space direction="vertical" size={16} style={{ width: '100%' }}>
      <label>配置<Select<Kind> aria-label="要复制的设置" value={kind} disabled={locked || loading} style={{ display: 'block', width: '100%', marginTop: 8 }} options={Object.entries(kindLabels).filter(([value]) => value !== 'CATALOG' || operation?.input.kind === 'CATALOG').map(([value, label]) => ({ value: value as Kind, label }))} onChange={value => { reset(); const selected = copyKindSelection(shops, source, target, value); setKind(value); setSource(selected.sourceId); setTarget(selected.targetId); setEntryError(''); }} /></label>
      <label>来源门店<Select aria-label="复制来源门店" value={source || undefined} loading={loading} disabled={locked || loading} placeholder="选择来源" style={{ display: 'block', width: '100%', marginTop: 8 }} options={eligible.map(shop => ({ value: shop.id, label: `${shop.name} · #${shop.id}` }))} onChange={value => { reset(); setEntryError(''); setSource(value); if (value === target) setTarget(''); }} /></label>
      <label>目标门店<Select aria-label="复制目标门店" value={target || undefined} disabled={locked || loading} placeholder="请选择另一家已授权门店" style={{ display: 'block', width: '100%', marginTop: 8 }} options={eligible.filter(shop => shop.id !== source).map(shop => ({ value: shop.id, label: `${shop.name} · #${shop.id}` }))} onChange={value => { reset(); setTarget(value); }} /></label>
      <Typography.Text type="secondary">{copyKindPermissionMessage(kind)}</Typography.Text>
      {!loading && !refreshing && !accessError && eligible.length < 2 && <Alert type="info" showIcon title="本类型可复制门店不足两家" description={copyKindPermissionMessage(kind) + ' 请联系公司核对关联门店授权；不会自动改选其他门店。'} />}
      <Button type="primary" disabled={!valid || locked} loading={previewBusy} onClick={() => void requestPreview()}>生成预览</Button>
    </Space></Card>
    {(operation?.error || error) && <Alert type="error" showIcon title={operation?.error || error} description="系统不会默认认定成功。未核实的重试会保留原门店组合、签名预览与操作键。" />}
    {(operation?.state === 'IN_FLIGHT' || operation?.state === 'CHECKING') && <Alert type="info" showIcon title={operation.state === 'CHECKING' ? '正在只读查询原操作结果' : '正在等待原复制结果'} description="您可以继续浏览，返回此处查看结果；切换工作区不会取消或替换原操作。" />}
    {operation?.state === 'UNKNOWN' && <Alert type="warning" showIcon title="原复制结果仍未知" description={<><p>可只读查询结果，或明确重试完全相同的原请求。之后出现权限错误并不能证明原操作失败；服务器确认结果前无法开始新复制。</p><Button disabled={busy} onClick={() => void check()}>查询原操作结果</Button></>} />}
    {shownPreview && <Card title="核对实际变化"><Typography.Paragraph>{shownPreview.summary}</Typography.Paragraph><Descriptions column={1} size="small" items={[{ key: 'source', label: '来源', children: name(displaySource) }, { key: 'target', label: '目标', children: name(displayTarget) }, { key: 'expires', label: '预览到期时间', children: new Date(shownPreview.expiresAt).toLocaleString('zh-CN') }]} />
      {shownPreview.changes.hours && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 16, marginTop: 16 }}><div><Typography.Text strong>目标当前营业时间</Typography.Text><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{formatBusinessHours(shownPreview.changes.hours.from)}</pre></div><div><Typography.Text strong>目标拟用营业时间</Typography.Text><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{formatBusinessHours(shownPreview.changes.hours.to)}</pre></div></div>}
      {shownPreview.changes.services && <Table rowKey="sourceId" size="small" pagination={false} scroll={{ x: 500 }} dataSource={shownPreview.changes.services} columns={[{ title: '服务', dataIndex: 'name' }, { title: '项目时长类型', render: (_: unknown, row: NonNullable<Preview['changes']['services']>[number]) => <Tag color="cyan">{SERVICE_DURATION_LABELS[readServiceDurationKind(row.durationKind)]}</Tag> }, { title: '操作', dataIndex: 'action', render: (value: string) => value === 'CREATE' ? '创建独立副本' : '跳过' }, { title: '原因', dataIndex: 'reason' }]} />}
      {shownPreview.changes.addOns && <AddOnCopySummary key={shownPreview.previewHash + ':add-ons'} rows={shownPreview.changes.addOns} />}
      {shownPreview.changes.priceMenu && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 16, marginTop: 16 }}><div><Typography.Text strong>目标当前项目与价目</Typography.Text><MenuSummary key={shownPreview.previewHash + ':from'} value={shownPreview.changes.priceMenu.from} /></div><div><Typography.Text strong>拟复制的项目与价目</Typography.Text><MenuSummary key={shownPreview.previewHash + ':to'} value={shownPreview.changes.priceMenu.to} /></div></div>{shownPreview.changes.priceMenu.catalogLinks && <CopyMenuLinks key={shownPreview.previewHash} links={shownPreview.changes.priceMenu.catalogLinks} />}{shownPreview.changes.priceMenu.omittedManagedImages > 0 && <Alert type="warning" showIcon title={`将省略 ${shownPreview.changes.priceMenu.omittedManagedImages} 张来源店专属图片`} description="价目文字会复制；目标店如需这些图片，请另行上传。" />}</>}
      {!operation && <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 20 }}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>已核对目标门店与全部变化，仅应用完整签名计划；分批预览不限制复制范围。</span></label>}
      <Button type="primary" style={{ marginTop: 16 }} disabled={operation ? operation.state !== 'UNKNOWN' || busy : !valid || !confirmed || busy} loading={operation?.state === 'IN_FLIGHT'} onClick={() => void apply()}>{operation ? '重试原操作' : `确认并应用到${name(target)}`}</Button>
    </Card>}
    {result && <Alert type="success" showIcon title="设置已复制" description={`${name(result.sourceShopId)} → ${name(result.targetShopId)}；${result.kind === 'PRICE_MENU' ? `已统一复制项目与价目，共 ${result.created} 项` : `已创建：${result.created}；已跳过：${result.skipped}`}。${result.kind === 'ADD_ONS' ? '新增附加项目均为停用状态，复核后手动启用；' : ''}请重新加载目标门店以查看已保存配置。`} />}
    {operation?.state === 'REJECTED' && <Alert type="warning" showIcon title="服务器已拒绝首次请求" description="此前没有结果未知的请求。请关闭此记录、刷新配置并重新生成预览后再尝试。" />}
    {operation?.state === 'NOT_APPLIED' && <Alert type="info" showIcon title="服务器已确认该请求未执行" description="签名预览已过期，且原请求没有执行记录。可关闭后生成新预览。" />}
    {terminal && <Button onClick={finish}>{storageWarning ? '重试安全清理并关闭结果' : '关闭结果并准备下一次复制'}</Button>}
    <Card title="本人近期成功复制" extra={<Button loading={historyBusy} onClick={() => setHistoryRevision(value => value + 1)}>刷新历史</Button>}>
      <Typography.Paragraph type="secondary">仅显示您目前有权访问的门店之间的成功操作。未查到记录并不证明未核实的请求失败。</Typography.Paragraph>
      {historyOwner === actor && historyError && <Alert type="error" title={historyError} />}
      <Table rowKey="operationId" size="small" loading={historyBusy} dataSource={historyOwner === actor && !refreshing && !accessError ? history?.items ?? [] : []} scroll={{ x: 760 }} pagination={{ current: historyPage, pageSize: 20, total: historyOwner === actor && !refreshing && !accessError ? history?.total ?? 0 : 0, showSizeChanger: false, onChange: setHistoryPage }} columns={[
        { title: '执行时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
        { title: '来源 → 目标', render: (_: unknown, item) => <span>{item.sourceShopName} · #{item.sourceShopId}<br />→ {item.targetShopName} · #{item.targetShopId}</span> },
        { title: '配置', dataIndex: 'kind', render: (value: Kind) => kindLabels[value] },
        { title: '项目／跳过', render: (_: unknown, item) => `${item.created} / ${item.skipped}` },
      ]} />
    </Card>
  </div>;
}
