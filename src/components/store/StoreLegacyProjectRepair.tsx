import { useEffect, useId, useState } from 'react';
import type { ProjectCatalogItem } from '../../utils/projectCatalog';
import type { ServiceWorkspaceDraft, WorkspaceMenuItem, WorkspaceSnapshot, WorkspaceTarget } from '../../types/serviceWorkspace';
import { workspaceCents, workspaceMoney, workspaceTitle } from '../../utils/serviceWorkspace';

const isUnlinked = (item: WorkspaceMenuItem) => !item.booking && !item.newVariantOf && item.bookingEnabled !== true;

export function hasLiteralPrice(text: string): boolean {
  return /(?:[$＄]\s*\d|\bUSD\s*\d|\d\s*(?:美[元金]|\b(?:USD|dollars?)\b))/iu.test(text);
}

export function legacyAssociationRows(snapshot: WorkspaceSnapshot, draft: ServiceWorkspaceDraft) {
  const originals = new Map(snapshot.priceMenu.flatMap(group => group.items.filter(isUnlinked).map(item => [item.id, item] as const)));
  return draft.displays.flatMap(display => {
    const original = originals.get(display.id);
    if (!display.id || !original) return [];
    const target = display.target;
    const variant = target.kind === 'VARIANT'
      ? draft.variants.find(row => row.key === ('id' in target ? target.id : target.tempKey)) : undefined;
    const saved = target.kind === 'VARIANT'
      ? snapshot.service?.variants.find(row => 'id' in target && row.id === target.id) : snapshot.service;
    const duration = variant?.duration ?? draft.duration;
    const price = variant?.price ?? draft.price;
    let cents: number | null;
    try { cents = workspaceCents(price); } catch { cents = null; }
    const priceChanged = cents !== saved?.priceCents;
    const currency = !priceChanged && saved && 'currency' in saved ? saved.currency?.toUpperCase() ?? 'USD' : 'USD';
    const perPerson = !priceChanged && saved?.priceBasis === 'PER_PERSON';
    const title = workspaceTitle(draft, display);
    return [{
      id: display.id, original, serviceName: draft.name.trim(), specName: variant?.name.trim() ?? '基础方案',
      duration, price: cents === null ? '待填写' : currency + ' ' + workspaceMoney(cents) + (perPerson ? ' / 人' : ' / 次'),
      active: draft.isActive && (variant?.isActive ?? true), title, description: display.description.trim(),
      titleNeedsReview: hasLiteralPrice(display.titleMode === 'AUTO' ? draft.name : display.name),
    }];
  });
}

type LegacyAssociationRow = ReturnType<typeof legacyAssociationRows>[number];
const choiceButton = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-40';
const confirmButton = 'rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40';

export function LegacyAssociationReview({ rows, disabled, onCancel, onConfirm }: {
  rows: LegacyAssociationRow[];
  disabled: boolean;
  onCancel: () => void;
  onConfirm: (visibility: ReadonlyMap<string, boolean>) => void;
}) {
  const scope = useId();
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const single = rows.length === 1 ? rows[0] : null;
  const complete = rows.length > 0 && rows.every(row => choices.has(row.id) && (!row.titleNeedsReview || choices.get(row.id) === false));
  return <div className="max-h-[85dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
    <h4 className="font-semibold text-slate-900">核对旧价目关联</h4>
    <p className="text-sm leading-6 text-slate-600">关联后以所选规格的价格和占用时间为准。每个位置都需选择顾客是否可见；保存时会同时提交当前服务的草稿。</p>
    {rows.map((row, index) => <fieldset className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-3" key={row.id} disabled={disabled}>
      <legend className="max-w-full break-words px-1 text-sm font-semibold text-slate-800">{row.original.name}</legend>
      <div className="grid min-w-0 gap-3 text-sm leading-6 text-slate-700 sm:grid-cols-2">
        <div className="min-w-0 break-words rounded-lg bg-slate-50 p-3">
          <h5 className="font-semibold">原展示资料</h5>
          <p>{row.original.isVisible === false ? '原来隐藏' : '原来可见'} · 仅展示，暂不可预约</p>
          <p className="whitespace-pre-wrap">{row.original.priceText || row.original.pricing?.legacySource?.priceText || '无单独价格文字'}</p>
          {row.original.description && <p className="whitespace-pre-wrap">{row.original.description}</p>}
        </div>
        <div className="min-w-0 break-words rounded-lg bg-teal-50 p-3">
          <h5 className="font-semibold">关联后的预约规格</h5>
          <p>{row.serviceName} · {row.specName}</p>
          <p>{row.duration} 分钟占用 · {row.price}</p>
          <p>{row.active ? '服务及所选规格启用' : '服务或规格已暂停，暂不可预约'}</p>
          <p>顾客标题将显示为「{row.title}」</p>
          {row.description && <p className="whitespace-pre-wrap">顾客说明　{row.description}</p>}
        </div>
      </div>
      {row.titleNeedsReview && <p className="text-sm leading-6 text-amber-800">标题仍含手写金额。可先保存为隐藏，或返回草稿，从标题中移除手写金额再公开。</p>}
      {hasLiteralPrice(row.description) && <p className="text-sm leading-6 text-amber-800">顾客说明中的金额仍会随说明显示。发布前请对照规格金额，返回草稿更新过期报价。</p>}
      {!single && <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" name={scope + '-' + index} checked={choices.get(row.id) === true}
          disabled={row.titleNeedsReview} onChange={() => setChoices(current => new Map(current).set(row.id, true))} />保存并继续展示</label>
        <label className="flex items-center gap-2"><input type="radio" name={scope + '-' + index} checked={choices.get(row.id) === false}
          onChange={() => setChoices(current => new Map(current).set(row.id, false))} />保存为隐藏</label>
      </div>}
    </fieldset>)}
    <p className="text-xs leading-6 text-slate-600">价目展示与预约状态分别控制。顾客能否在线预约，仍取决于门店发布及预约开关、营业时间、技师排班、场地和所选时段是否可用。</p>
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={choiceButton} onClick={onCancel}>返回草稿</button>
      {single ? <>
        <button type="button" className={choiceButton} disabled={disabled} onClick={() => onConfirm(new Map([[single.id, false]]))}>保存为隐藏</button>
        <button type="button" className={confirmButton} disabled={disabled || single.titleNeedsReview} onClick={() => onConfirm(new Map([[single.id, true]]))}>保存并继续展示</button>
      </> : <button type="button" className={confirmButton} disabled={disabled || !complete} onClick={() => onConfirm(choices)}>确认关联并保存</button>}
    </div>
  </div>;
}

export interface StoreLegacyProjectRepairProps {
  snapshot: WorkspaceSnapshot;
  disabled: boolean;
  service: ProjectCatalogItem | null;
  variants: { key: string; id?: string; name: string }[];
  associatedItemIds: ReadonlySet<string | undefined>;
  onAssociate: (itemId: string, target: WorkspaceTarget) => void;
  onConvert: (itemId: string) => void;
  onRemove: (itemId: string) => void;
}

/** Repair only exact, unbound legacy positions. The enclosing workspace owns
 * the draft, confirmation, pending journal and atomic command for every action. */
export default function StoreLegacyProjectRepair({ snapshot, disabled, service, variants, associatedItemIds, onAssociate, onConvert, onRemove }: StoreLegacyProjectRepairProps) {
  const rows = snapshot.priceMenu.flatMap((group, groupIndex) => group.items.map((item, position) => ({ item, group: group.category, groupIndex, position })))
    .filter(({ item }) => isUnlinked(item));
  const [selectedTarget, setSelectedTarget] = useState('');
  useEffect(() => { setSelectedTarget(''); }, [snapshot.shopId, service?.id]);
  if (!rows.length) return null;
  const targets: { value: string; label: string; target: WorkspaceTarget }[] = variants.length
    ? variants.map(variant => ({ value: variant.id ? 'id:' + variant.id : 'temp:' + variant.key, label: variant.name || '未命名规格', target: variant.id ? { kind: 'VARIANT', id: variant.id } : { kind: 'VARIANT', tempKey: variant.key } }))
    : service ? [{ value: 'service', label: service.name + ' · 旧基础方案', target: { kind: 'SERVICE' } }] : [];
  const target = targets.find(value => value.value === selectedTarget)?.target;
  return <details className="min-w-0 rounded-xl border border-amber-200 bg-amber-50/40 p-4" onKeyDown={event => {
    if (event.key === 'Enter' && event.target instanceof HTMLElement && event.target.matches('input,select')) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <summary className="cursor-pointer text-sm font-semibold text-amber-950">旧资料修复 · {rows.length} 个未关联展示位置</summary>
    <div className="mt-4 space-y-4">
      <p className="text-xs leading-6 text-slate-600">这些位置仅展示，暂不可预约。选择当前服务的准确规格，或转为新服务草稿并补全价格和预约占用时间。提交前会显示原文、所选规格和顾客展示选项。</p>
      <fieldset disabled={disabled || !snapshot.canManageCatalog} className="min-w-0 space-y-4">
        <label className="block min-w-0 space-y-2 text-sm text-slate-700"><span>关联目标 · {service?.name || (variants.length ? '当前新服务草稿' : '请先打开要关联的服务')}</span>
          <select className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5" value={target ? selectedTarget : ''} onChange={event => { if (!disabled) setSelectedTarget(event.currentTarget.value); }}>
            <option value="">明确选择当前服务的规格…</option>{targets.map(value => <option key={value.value} value={value.value}>{value.label}</option>)}
          </select>
        </label>
        <div className="space-y-3">{rows.map(({ item, group, groupIndex, position }) => <article key={item.id ?? `missing-${groupIndex}-${position}`} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
          <h5 className="break-words text-sm font-semibold text-slate-800">{item.name}</h5>
          <p className="mt-1 break-words text-xs leading-6 text-slate-500">{group || '未命名分组'} · 第 {position + 1} 位 · {item.isVisible === false ? '顾客隐藏' : '顾客可见'}</p>
          {item.priceText && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-slate-600">旧价格文字：{item.priceText}</p>}
          <p className="mt-1 break-all text-xs text-slate-400">位置编号：{item.id || '缺失，需先重新加载完整资料'}</p>
          {item.id && associatedItemIds.has(item.id) && <p role="status" className="mt-1 text-xs leading-6 text-teal-800">已加入当前服务草稿。提交时核对关联规格与展示方式。</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={!item.id || !target || associatedItemIds.has(item.id)} className={choiceButton}
              onClick={() => { if (!disabled && snapshot.canManageCatalog && item.id && target && !associatedItemIds.has(item.id)) onAssociate(item.id, target); }}>关联到所选规格草稿</button>
            <button type="button" disabled={!item.id} className={choiceButton}
              onClick={() => { if (!disabled && snapshot.canManageCatalog && item.id) onConvert(item.id); }}>转为新服务草稿</button>
            <button type="button" disabled={!item.id} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-40"
              onClick={() => { if (!disabled && snapshot.canManageCatalog && item.id) onRemove(item.id); }}>永久移除此位置…</button>
          </div>
        </article>)}</div>
        <p className="text-xs leading-6 text-slate-500">通过“保存当前服务”或“创建服务”核对并提交关联。永久移除需单独确认。仅想暂时隐藏此位置，请编辑原展示文字并关闭“顾客价目显示”。</p>
      </fieldset>
    </div>
  </details>;
}
