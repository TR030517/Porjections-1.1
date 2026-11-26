import { useEffect, useRef, useState } from 'react';
import type { CatalogMutationAction, CatalogMutationReceipt, CatalogMutationRequest } from '../../types/catalogMutation';
import type { PriceMenuGroup } from '../../utils/priceMenu';
import type { ProjectCatalogItem } from '../../utils/projectCatalog';
import { PROJECT_METADATA_CATEGORIES } from '../../utils/projectMetadata';
import { reservationVariantPriceCents } from '../../utils/reservationForm';
import { catalogMutationRejected, readCatalogMutationReceipt } from '../../utils/catalogMutation';
import { EMPTY_BUSINESS_LIFECYCLE, type BusinessLifecycleListener } from '../../utils/businessLifecycle';
import './StoreCatalogCreate.css';

interface Draft {
  action: CatalogMutationAction; key: string; revision: string; project?: ProjectCatalogItem;
  name: string; description: string; category: string; variantName: string; duration: string; price: string;
  variantId: string; display: boolean; group: string; newGroup: string;
}
export interface StoreCatalogCreateProps {
  shopId: string; scopeKey: string; menu: PriceMenuGroup[]; priceMenuRevision: string; project?: ProjectCatalogItem;
  disabled: boolean; beforeWrite: () => boolean; isCurrent: () => boolean;
  submit: (shopId: string, request: CatalogMutationRequest) => Promise<unknown>;
  readReceipt: (shopId: string, key: string) => Promise<unknown>;
  onSaved: (receipt: CatalogMutationReceipt) => Promise<void>;
  onLifecycleChange: BusinessLifecycleListener;
}

/** Creates catalog objects and their optional customer row in one explicit transaction. */
export default function StoreCatalogCreate({ shopId, scopeKey, menu, priceMenuRevision, project, disabled, beforeWrite, isCurrent, submit, readReceipt, onSaved, onLifecycleChange }: StoreCatalogCreateProps) {
  const [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(true), locked = useRef(false), pending = useRef<CatalogMutationRequest | null>(null);
  const draftRef = useRef(draft), unknownRef = useRef(unknown);
  draftRef.current = draft; unknownRef.current = unknown;
  const live = useRef({ scopeKey, generation: 0, disabled, isCurrent, beforeWrite });
  if (live.current.scopeKey !== scopeKey) live.current = { scopeKey, generation: live.current.generation + 1, disabled, isCurrent, beforeWrite };
  else Object.assign(live.current, { disabled, isCurrent, beforeWrite });
  const eventGeneration = live.current.generation;
  const eventCurrent = () => mounted.current && eventGeneration === live.current.generation && live.current.isCurrent();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onLifecycleChange({ dirty: !!draft, busy, unknown }); }, [draft, busy, unknown, onLifecycleChange]);
  useEffect(() => () => onLifecycleChange(EMPTY_BUSINESS_LIFECYCLE), [onLifecycleChange]);
  const capture = () => eventCurrent;
  const replaceDraft = (next: Draft | null) => { draftRef.current = next; setDraft(next); };
  const markUnknown = (next: boolean) => { unknownRef.current = next; setUnknown(next); };
  const start = (action: CatalogMutationAction) => {
    if (live.current.disabled || locked.current || draftRef.current || unknownRef.current || !eventCurrent() || !live.current.beforeWrite()) return;
    if (!/^[a-f0-9]{64}$/.test(priceMenuRevision)) { setError('请先载入完整的已保存顾客价目，再创建服务或规格。'); return; }
    if (action !== 'CREATE_SERVICE' && !project) return;
    pending.current = null; markUnknown(false); setError(''); setNotice('');
    replaceDraft({ action, key: crypto.randomUUID(), revision: priceMenuRevision, project: action === 'CREATE_SERVICE' ? undefined : project,
      name: '', description: '', category: 'MASSAGE', variantName: '', duration: '60', price: '', variantId: '', display: true, group: menu.length ? '0' : 'new', newGroup: '' });
  };
  const patch = (next: Partial<Draft>) => { if (draft && draftRef.current === draft && !locked.current && !unknownRef.current && !live.current.disabled && eventCurrent()) { replaceDraft({ ...draft, ...next }); setError(''); } };
  const cancel = () => {
    if (!draft || draftRef.current !== draft || locked.current || unknownRef.current || !eventCurrent()) return;
    replaceDraft(null); pending.current = null; setError('');
  };
  const acknowledge = async (raw: unknown, request: CatalogMutationRequest, current: () => boolean) => {
    const receipt = readCatalogMutationReceipt(raw, shopId, request);
    if (!current()) return;
    await onSaved(receipt);
    if (!current()) return;
    replaceDraft(null); pending.current = null; markUnknown(false); setError('');
    setNotice(receipt.displayStatus === 'ALREADY_LINKED' ? '此规格已在顾客价目中，没有重复创建；已重新读取目录。' : `已保存${receipt.created.service ? '新服务和首个规格' : receipt.created.variant ? '同一服务的新规格' : '已有规格的展示关联'}${receipt.displayStatus === 'ADDED' ? '及顾客价目展示行' : '，未加入顾客价目'}，并已重新读取。`);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (!draft || draftRef.current !== draft || locked.current || unknownRef.current || live.current.disabled || !eventCurrent() || !live.current.beforeWrite()) return;
    let request: CatalogMutationRequest;
    try {
      const display: CatalogMutationRequest['display'] = draft.display ? draft.group === 'new' ? { newGroupCategory: draft.newGroup.trim() } : { groupIndex: Number(draft.group) } : undefined;
      if (display && ('newGroupCategory' in display ? !display.newGroupCategory || display.newGroupCategory.length > 100 : !Number.isInteger(display.groupIndex) || !menu[display.groupIndex])) throw Error('请选择展示分组，或填写新分组名称。');
      request = { action: draft.action, idempotencyKey: draft.key, expectedPriceMenuRevision: draft.revision, ...(display ? { display } : {}) };
      if (draft.action === 'CREATE_SERVICE') {
        const name = draft.name.trim(), description = draft.description.trim();
        if (!name) throw Error('请填写服务名称。');
        if (name.length > 200) throw Error('服务名称最多 200 个字符。');
        if (description.length > 10000) throw Error('服务说明最多 10000 个字符。');
        request.service = { name, description, category: draft.category as NonNullable<CatalogMutationRequest['service']>['category'], durationKind: 'TIMED', isActive: true };
      } else {
        if (!draft.project) throw Error('请重新选择本店服务。');
        request.serviceId = draft.project.id; request.expectedSelectionRevision = draft.project.selectionRevision;
      }
      if (draft.action === 'LINK_EXISTING_VARIANT') {
        if (!draft.display || !draft.project?.variants.some(value => value.id === draft.variantId)) throw Error('请选择已有规格及展示分组。');
        request.variantId = draft.variantId;
      } else {
        const name = draft.variantName.trim();
        if (!name) throw Error('请填写规格名称，例如 120 min。');
        if (name.length > 100) throw Error('规格名称最多 100 个字符。');
        if (!/^\d+$/.test(draft.duration) || Number(draft.duration) < 5 || Number(draft.duration) > 240) throw Error('规格时长须为 5–240 的整数分钟。');
        request.variant = { name, durationMin: Number(draft.duration), priceCents: reservationVariantPriceCents(draft.price), isActive: true };
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '请核对服务资料。'); return; }
    const current = capture();
    if (!current() || draftRef.current !== draft || unknownRef.current || !live.current.beforeWrite()) return;
    locked.current = true; setBusy(true); setError(''); pending.current = request;
    let received = false;
    try { const raw = await submit(shopId, request); received = true; if (current()) await acknowledge(raw, request, current); }
    catch (cause) {
      if (current()) {
        const uncertain = received || !catalogMutationRejected(cause);
        markUnknown(uncertain);
        setError((cause instanceof Error ? cause.message : '保存未能确认。') + (uncertain ? ' 本次可能已经保存，输入与操作编号保留，请只读核对；不会重复创建。' : ' 本次未获接受，输入保留。版本冲突时请取消本次编辑并载入最新资料后重试。'));
      }
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const check = async () => {
    const request = pending.current;
    if (!draft || draftRef.current !== draft || !unknownRef.current || locked.current || !request || !eventCurrent()) return;
    const current = capture(); locked.current = true; setBusy(true); setError('');
    try { const raw = await readReceipt(shopId, request.idempotencyKey); if (current()) await acknowledge(raw, request, current); }
    catch (cause) { if (current()) setError((cause instanceof Error ? cause.message : '暂未读取到保存回执。') + ' 本次结果仍待核对，输入保留；不会再次提交。'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="store-catalog-create" aria-label="新增服务与规格">
    {!draft && <div className="store-catalog-create__actions"><button type="button" disabled={disabled} onClick={() => start('CREATE_SERVICE')}>＋ 新增服务</button>{project && <><button type="button" disabled={disabled} onClick={() => start('CREATE_VARIANT')}>＋ 为此服务新增规格</button><button type="button" disabled={disabled || !project.variants.length} onClick={() => start('LINK_EXISTING_VARIANT')}>将已有规格加入顾客价目</button></>}</div>}
    {draft && <form onSubmit={event => void save(event)} aria-label="创建服务或规格" className="store-catalog-create__form">
      <h4>{draft.action === 'CREATE_SERVICE' ? '新增服务与首个规格' : draft.action === 'CREATE_VARIANT' ? `为 ${draft.project?.name} 新增规格` : `把 ${draft.project?.name} 的已有规格加入价目`}</h4>
      <p>服务是共同资料，规格是可预约的时长与价格，展示行是顾客价目中的位置。{draft.action === 'CREATE_VARIANT' && '新规格继承当前服务的顾客人数、技师数及资源规则，不新建另一个服务。'}</p>
      {draft.project && !draft.project.isActive && <p role="status">此服务已暂停；添加规格或展示行不会启用服务，也不会开放新预约。</p>}
      <fieldset disabled={disabled || busy || unknown}>
        {draft.action === 'CREATE_SERVICE' && <><label>服务名称<input required maxLength={200} value={draft.name} onChange={event => patch({ name: event.target.value })} /></label><label>服务类别<select value={draft.category} onChange={event => patch({ category: event.target.value })}>{PROJECT_METADATA_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="store-catalog-create__wide">服务说明<textarea maxLength={10000} rows={2} value={draft.description} onChange={event => patch({ description: event.target.value })} /></label></>}
        {draft.action === 'LINK_EXISTING_VARIANT' ? <label className="store-catalog-create__wide">已有规格<select required value={draft.variantId} onChange={event => patch({ variantId: event.target.value })}><option value="">请选择已有规格</option>{draft.project?.variants.map(variant => <option key={variant.id} value={variant.id}>{variant.name} · {variant.durationMin} min · USD {((variant.priceCents ?? 0) / 100).toFixed(2)}{variant.isActive ? '' : ' · 已暂停'}</option>)}</select></label> : <><label>规格名称<input required maxLength={100} placeholder="例如 120 min" value={draft.variantName} onChange={event => patch({ variantName: event.target.value })} /></label><label>预约占用时长（分钟）<input required type="number" min={5} max={240} step={1} value={draft.duration} onChange={event => patch({ duration: event.target.value })} /></label><label>整次订单价格（USD）<input required type="text" inputMode="decimal" placeholder="例如 100.25" value={draft.price} onChange={event => patch({ price: event.target.value })} /></label></>}
        <label className="store-catalog-create__check store-catalog-create__wide"><input type="checkbox" disabled={draft.action === 'LINK_EXISTING_VARIANT'} checked={draft.display} onChange={event => patch({ display: event.target.checked })} />同时显示到顾客价目</label>
        {draft.display && <><label>展示分组<select value={draft.group} onChange={event => patch({ group: event.target.value })}>{menu.map((group, index) => <option key={index} value={String(index)}>{index + 1}. {group.category || '未命名分组'}</option>)}<option value="new">＋ 新建展示分组</option></select></label>{draft.group === 'new' && <label>新展示分组名称<input required maxLength={100} value={draft.newGroup} onChange={event => patch({ newGroup: event.target.value })} /></label>}</>}
      </fieldset>
      <p>点击下面按钮，只保存本次服务／规格和所选展示行；其他门店草稿不会一起提交。店内技师默认均可承接本店项目，营业时间与预约开关仍使用门店设置。</p>
      <div className="store-catalog-create__actions">{unknown ? <button type="button" disabled={busy} onClick={() => void check()}>只读核对本次保存结果</button> : <><button type="submit" disabled={disabled || busy}>{busy ? '正在保存…' : draft.display ? '保存并加入顾客价目' : '保存到本店服务'}</button><button type="button" disabled={busy} onClick={cancel}>取消本次新增</button></>}</div>
    </form>}
    {error && <p role="alert" className="store-catalog-create__error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
