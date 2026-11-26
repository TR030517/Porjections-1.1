import type { ProjectCatalogItem, ProjectCatalogQuery } from './projectCatalog';
import { projectCatalogId, readProjectCatalogPage } from './projectCatalog';
import { safePriceMenuImage, validatePriceMenu } from './priceMenu';
import { formatPriceMenuTitle, type PriceMenuPricing } from './priceMenuPricing';
import type { SaveServiceWorkspace, ServiceWorkspaceDraft, WorkspaceCommand, WorkspaceDisplayDraft, WorkspaceFieldIssue, WorkspaceMenuGroup, WorkspaceReceipt, WorkspaceSnapshot, WorkspaceTarget } from '../types/serviceWorkspace';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const workspaceKey = () => 'w' + crypto.randomUUID().replace(/-/g, '');
export const workspaceMoney = (value: number | null | undefined) => Number.isSafeInteger(value) ? (value! / 100).toFixed(2) : '';
export function workspaceCents(value: string, free = false): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())) throw Error('美元金额最多两位小数，不接受负数或科学计数。');
  const [whole, fraction = ''] = value.trim().split('.'), cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < (free ? 0 : 1) || cents > 10000000) throw Error(`金额须为 ${free ? '0' : '0.01'}–100000 USD。`);
  return cents;
}
function integer(value: string, min: number, max: number) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw Error(`请填写 ${min}–${max} 的整数。`);
  return Number(value);
}
function plain(value: string, max: number, required = false, multiline = false) {
  const control = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (value.length > max || required && !value.trim() || control.test(value) || /<\/?[a-z][^>]*>/iu.test(value)) throw Error(`请填写${required ? '非空' : ''}纯文本，最多 ${max} 字。`);
  return value.replace(/\r\n?/g, '\n').trim();
}
export function readWorkspaceSnapshot(raw: unknown, shopId: string, serviceId?: string): WorkspaceSnapshot {
  if (!record(raw) || raw.shopId !== shopId || !hash(raw.priceMenuRevision) || typeof raw.canManageCatalog !== 'boolean' || typeof raw.canConfigurePolicy !== 'boolean' || !Array.isArray(raw.priceMenu)) throw Error('服务与价目读取不完整，请重新载入。');
  // Visibility is validated separately so older validators cannot silently discard it.
  const source = raw.priceMenu as WorkspaceMenuGroup[];
  const ids=source.flatMap(group=>Array.isArray(group.items)?group.items.map(row=>row.id).filter(Boolean):[]);
  if(new Set(ids).size!==ids.length)throw Error('展示位置编号重复，未接收不完整价目。');
  const stripped = source.map(group => ({ ...group, items: Array.isArray(group.items) ? group.items.map(item => {
    const { isVisible, ...rest } = item;
    if (isVisible !== undefined && typeof isVisible !== 'boolean') throw Error('显示状态无效。');
    // Snapshot-only tokens are exact, revision-bound legacy identities, never sent to old APIs.
    if (typeof rest.id === 'string' && /^legacy:\d+:\d+:[a-f0-9]{16}$/.test(rest.id)) { const { id, ...withoutId } = rest; return withoutId; }
    return rest;
  }) : group.items }));
  validatePriceMenu(stripped);
  let service: ProjectCatalogItem | null = null;
  if (serviceId) {
    if (!record(raw.service) || raw.service.id !== serviceId || !hash(raw.selectionRevision)) throw Error('指定服务未完整读取，未替换为其他服务。');
    const query: ProjectCatalogQuery = { serviceId, search: '', status: 'all', page: 1, pageSize: 1 };
    service = readProjectCatalogPage({ ...query, shopId, total: 1, hasMore: false, canManageCatalog: raw.canManageCatalog, canConfigurePolicy: raw.canConfigurePolicy, items: [{ ...raw.service, selectionRevision: raw.selectionRevision }] }, shopId, query).items[0];
  } else if (raw.service !== null || raw.selectionRevision !== null) throw Error('新服务基线范围不符。');
  return { shopId, service, priceMenu: structuredClone(source), priceMenuRevision: raw.priceMenuRevision, selectionRevision: raw.selectionRevision as string | null, canManageCatalog: raw.canManageCatalog, canConfigurePolicy: raw.canConfigurePolicy };
}
export function workspaceDraft(snapshot: WorkspaceSnapshot): ServiceWorkspaceDraft {
  const s = snapshot.service;
  const draft: ServiceWorkspaceDraft = {
    serviceId: s?.id, name: s?.name ?? '', description: s?.description ?? '', category: s?.category ?? 'MASSAGE', durationKind: s?.durationKind ?? 'TIMED', isActive: s?.isActive ?? true,
    duration: s?.durationMin == null ? '' : String(s.durationMin), price: workspaceMoney(s?.priceCents), participantCount: String(s?.participantCount ?? 1), requiredStaffCount: String(s?.requiredStaffCount ?? 1),
    requiredRoomType: s?.requiredRoomType ?? '', staffBuffer: String(s?.staffBufferMin ?? 0), roomBuffer: String(s?.roomBufferMin ?? 0), variants: [], addOns: [], displays: [], newGroups: [], defaultGroup: snapshot.priceMenu.length ? 'g:0' : '', defaultImage: '',
  };
  if (s) {
    draft.variants = s.variants.map(v => ({ key: v.id, id: v.id, name: v.name, duration: v.durationMin == null ? '' : String(v.durationMin), price: workspaceMoney(v.priceCents), isActive: v.isActive, sortOrder: String(v.sortOrder ?? 0) }));
    draft.addOns = s.addOns.map(a => ({ key: a.id, id: a.id, name: a.name, description: a.description ?? '', price: workspaceMoney(a.priceCents), isActive: a.isActive, sortOrder: String(a.sortOrder ?? 0) }));
    snapshot.priceMenu.forEach((group, index) => group.items.forEach((item, position) => {
      if (item.booking?.serviceId !== s.id) return;
      draft.displays.push({ key: item.id ?? `missing_${index}_${position}`, id: item.id, target: item.booking.variantId ? { kind: 'VARIANT', id: item.booking.variantId } : item.booking.addOnId ? { kind: 'ADD_ON', id: item.booking.addOnId } : { kind: 'SERVICE' },
        group: 'g:' + index, position: String(position), name: item.name, description: item.description ?? '', imageUrl: item.imageUrl ?? '', isVisible: item.isVisible !== false, titleMode: item.pricing?.titleMode ?? 'CUSTOM' });
    }));
  } else {
    const key = workspaceKey(); draft.variants.push({ key, name: '', duration: '60', price: '', isActive: true, sortOrder: '0' });
    if (!draft.defaultGroup) { const group = workspaceKey(); draft.newGroups.push({ key: group, category: 'Services' }); draft.defaultGroup = 'n:' + group; }
    draft.displays.push(newWorkspaceDisplay(draft, { kind: 'VARIANT', tempKey: key }));
  }
  return draft;
}
export function newWorkspaceDisplay(draft: ServiceWorkspaceDraft, target: WorkspaceTarget): WorkspaceDisplayDraft {
  return { key: workspaceKey(), target, group: draft.defaultGroup, position: '', name: '', description: '', imageUrl: draft.defaultImage, isVisible: true, titleMode: 'AUTO' };
}
export const workspaceFingerprint = (value: ServiceWorkspaceDraft) => { const { defaultGroup, defaultImage, ...business } = value; return JSON.stringify(business); };
export function targetKey(target: WorkspaceTarget) { return target.kind + ':' + ('id' in target ? target.id : 'tempKey' in target ? target.tempKey : 'base'); }
export function workspaceTitle(draft: ServiceWorkspaceDraft, display: WorkspaceDisplayDraft): string {
  if (display.titleMode === 'CUSTOM') return display.name;
  const target = display.target;
  const row = target.kind === 'VARIANT' ? draft.variants.find(v => v.key === ('id' in target ? target.id : target.tempKey)) : target.kind === 'ADD_ON' ? draft.addOns.find(a => a.key === ('id' in target ? target.id : target.tempKey)) : null;
  try {
    const kind = target.kind === 'ADD_ON' ? 'ADD_ON' : draft.durationKind as PriceMenuPricing['kind'];
    return formatPriceMenuTitle({ kind, baseName: target.kind === 'ADD_ON' ? row?.name || 'Add-on' : draft.name || 'Service', durationMin: kind === 'TIMED' ? Number(row && 'duration' in row ? row.duration : draft.duration) || null : null, priceCents: workspaceCents(row?.price ?? draft.price, target.kind === 'ADD_ON'), titleMode: 'AUTO' });
  } catch { return target.kind === 'ADD_ON' ? row?.name || 'Add-on' : draft.name || 'Service'; }
}
function groupRef(value: string) { if (/^g:\d+$/.test(value)) return { index: Number(value.slice(2)) }; if (/^n:[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) return { tempKey: value.slice(2) }; throw Error('请选择顾客展示分组，或先建立本地新分组。'); }
export function buildWorkspaceCommand(snapshot: WorkspaceSnapshot, draft: ServiceWorkspaceDraft, key: string): SaveServiceWorkspace {
  const baseline = workspaceDraft(snapshot), issues: WorkspaceFieldIssue[] = [];
  const check = <T>(field: string, run: () => T): T | undefined => { try { return run(); } catch (e) { issues.push({ field, message: e instanceof Error ? e.message : '字段无效。' }); return undefined; } };
  const command: SaveServiceWorkspace = { action: 'SAVE_SERVICE_WORKSPACE', idempotencyKey: key, expectedPriceMenuRevision: snapshot.priceMenuRevision, ...(draft.serviceId ? { serviceId: draft.serviceId, expectedSelectionRevision: snapshot.selectionRevision! } : {}) };
  const service: Record<string, unknown> = {}, policy: Record<string, unknown> = {};
  const field = (key: keyof ServiceWorkspaceDraft, output: string, parse: () => unknown, into = service) => { if (!draft.serviceId || draft[key] !== baseline[key]) { const value = check(String(key), parse); if (value !== undefined) into[output] = value; } };
  field('name', 'name', () => plain(draft.name, 200, true)); field('description', 'description', () => plain(draft.description, 10000, false, true));
  field('category', 'category', () => { if (!['MASSAGE','REFLEXOLOGY','CUPPING','SCRAPING','HEAD_THERAPY','OTHER'].includes(draft.category)) throw Error('请选择有效服务类别。'); return draft.category; });
  field('isActive', 'isActive', () => draft.isActive); field('durationKind', 'durationKind', () => { if (!['TIMED','PER_SESSION','VARIABLE'].includes(draft.durationKind)) throw Error('请选择有效服务类型。'); return draft.durationKind; });
  if (draft.serviceId && !snapshot.service!.hasVariants) { field('duration', 'durationMin', () => integer(draft.duration, 5, 240)); field('price', 'priceCents', () => workspaceCents(draft.price)); }
  field('participantCount', 'participantCount', () => integer(draft.participantCount, 1, 2), policy); field('requiredStaffCount', 'requiredStaffCount', () => integer(draft.requiredStaffCount, 1, 2), policy);
  field('requiredRoomType', 'requiredRoomType', () => { if (!['','SINGLE','COUPLE','FOOT_SEAT'].includes(draft.requiredRoomType)) throw Error('场地类型无效。'); return draft.requiredRoomType || null; }, policy);
  field('staffBuffer', 'staffBufferMin', () => integer(draft.staffBuffer, 0, 120), policy); field('roomBuffer', 'roomBufferMin', () => integer(draft.roomBuffer, 0, 120), policy);
  if (Object.keys(policy).length && (Number(draft.requiredStaffCount) < Number(draft.participantCount) || draft.participantCount === '2' && !['','COUPLE'].includes(draft.requiredRoomType))) issues.push({ field: 'participantCount', message: '情侣须两客两技师，场地只能为双人房或不绑定。' });
  if (Object.keys(service).length) command.service = service;
  // Creating with untouched safe defaults must not request RESERVATION_CONFIG merely because the form displays defaults.
  if (!draft.serviceId) for (const [k, v] of Object.entries({ participantCount: 1, requiredStaffCount: 1, requiredRoomType: null, staffBufferMin: 0, roomBufferMin: 0 })) if (policy[k] === v) delete policy[k];
  if (Object.keys(policy).length) command.policy = policy;
  if (draft.variants.length > 200 || draft.addOns.length > 50) issues.push({ field: 'variants', message: '每个服务最多 200 个规格和 50 个附加项，不能截断目录保存。' });
  if(snapshot.priceMenu.length+draft.newGroups.length>100||draft.displays.length>1000)issues.push({field:'displays',message:'价目最多100个分组及1000个位置，请先整理。'});
  command.variants = draft.variants.flatMap((row, index) => {
    const old = baseline.variants.find(v => v.id === row.id && !!row.id), changes: Record<string, unknown> = {};
    const set = (draftKey: keyof typeof row, out: string, parse: () => unknown) => { if (!old || row[draftKey] !== old[draftKey]) { const value = check(`variants.${index}.${draftKey}`, parse); if (value !== undefined) changes[out] = value; } };
    set('name','name',() => plain(row.name,100,true)); set('duration','durationMin',() => integer(row.duration,5,240)); set('price','priceCents',() => workspaceCents(row.price)); set('isActive','isActive',() => row.isActive); set('sortOrder','sortOrder',() => integer(row.sortOrder,0,10000));
    return Object.keys(changes).length ? [{ ...(row.id ? { id: row.id } : { tempKey: row.key }), changes }] : [];
  });
  command.addOns = draft.addOns.flatMap((row,index) => {
    const old = baseline.addOns.find(v => v.id === row.id && !!row.id), changes: Record<string, unknown> = {};
    const set = (draftKey: keyof typeof row, out: string, parse: () => unknown) => { if (!old || row[draftKey] !== old[draftKey]) { const value = check(`addOns.${index}.${draftKey}`,parse); if (value !== undefined) changes[out] = value; } };
    set('name','name',() => plain(row.name,100,true)); set('description','description',() => plain(row.description,1000,false,true)); set('price','priceCents',() => workspaceCents(row.price,true)); set('isActive','isActive',() => row.isActive); set('sortOrder','sortOrder',() => integer(row.sortOrder,0,10000));
    return Object.keys(changes).length ? [{ ...(row.id ? { id: row.id } : { tempKey: row.key }), changes }] : [];
  });
  command.newGroups = draft.newGroups.map((group,index) => ({ tempKey: group.key, category: check('newGroups.' + index,() => plain(group.category,200,true)) ?? '' }));
  command.displays = draft.displays.flatMap((row,index) => {
    const old = baseline.displays.find(v => v.key === row.key), changes: Record<string, unknown> = {};
    if (old && !old.id) { if (JSON.stringify(old) !== JSON.stringify(row)) issues.push({ field: 'displays.' + index, message: '旧展示位置缺少稳定编号，请先重新载入；不会按标题猜测并覆盖。' }); return []; }
    const set = (key: keyof WorkspaceDisplayDraft, parse: () => unknown) => { if (!old || old[key] !== row[key]) { const value = check(`displays.${index}.${key}`,parse); if (value !== undefined) changes[key] = value; } };
    if (row.titleMode === 'CUSTOM') set('name',() => plain(row.name,300,true));
    set('description',() => plain(row.description,2000,false,true)); set('imageUrl',() => { if (row.imageUrl && !safePriceMenuImage(row.imageUrl)) throw Error('请选择图库图片、受管媒体或有效 HTTPS 图片地址。'); return row.imageUrl.trim(); }); set('isVisible',() => row.isVisible); set('titleMode',() => row.titleMode);
    const group = !old || old.group !== row.group ? check(`displays.${index}.group`,() => groupRef(row.group)) : undefined;
    const position = row.position !== '' && (!old || old.position !== row.position) ? check(`displays.${index}.position`,() => integer(row.position,0,1000)) : undefined;
    return Object.keys(changes).length || group || position !== undefined ? [{ ...(row.id ? { id: row.id, ...(!old ? { target: row.target } : {}) } : { tempKey: row.key, target: row.target }), ...(group ? { group } : {}), ...(position !== undefined ? { position } : {}), changes }] : [];
  });
  if (!draft.serviceId && !draft.variants.length) issues.push({ field: 'variants', message: '新服务至少填写一个规格。' });
  const catalogChanged = !!command.service || !!command.variants.length || !!command.addOns.length || !!command.displays.length || !!command.newGroups.length;
  if (catalogChanged && !snapshot.canManageCatalog) issues.push({ field: 'permission', message: '当前账号不能修改服务目录与展示。' });
  if (command.policy && !snapshot.canConfigurePolicy) issues.push({ field: 'permission', message: '当前账号不能修改预约规则；未提交任何字段。' });
  if (issues.length) { const error = Error('请核对标记字段。') as Error & { issues: WorkspaceFieldIssue[] }; error.issues = issues; throw error; }
  for (const k of ['variants','addOns','displays','newGroups'] as const) if (!command[k]?.length) delete command[k];
  return command;
}
export function workspaceHasChanges(command: SaveServiceWorkspace) { return !!(command.service || command.policy || command.variants?.length || command.addOns?.length || command.displays?.length || command.newGroups?.length); }
export function readWorkspaceReceipt(raw: unknown, shopId: string, command: WorkspaceCommand): WorkspaceReceipt {
  if (!record(raw) || raw.shopId !== shopId || raw.idempotencyKey !== command.idempotencyKey || !['COMMITTED','NOT_EXECUTED'].includes(String(raw.outcome)) || typeof raw.operationId !== 'string' || !hash(raw.priceMenuRevision) || !Array.isArray(raw.warnings)||raw.warnings.some(v=>typeof v!=='string')||!Array.isArray(raw.requiredPermissions)||raw.requiredPermissions.some(v=>!['CATALOG_MANAGE','RESERVATION_CONFIG'].includes(v))) throw Error('操作回执与当前门店或操作编号不符，继续保持待核对。');
  if (raw.outcome === 'COMMITTED' && (raw.action !== command.action || !record(raw.idMap) || !record(raw.idMap.variants) || !record(raw.idMap.addOns) || !record(raw.idMap.displays) || command.action === 'SAVE_SERVICE_WORKSPACE' && (!projectCatalogId(raw.serviceId) || command.serviceId && command.serviceId !== raw.serviceId || !hash(raw.selectionRevision)))) throw Error('保存回执缺少当前服务的精确映射，继续保持待核对。');
  if (raw.outcome === 'NOT_EXECUTED' && raw.action !== null && raw.action !== command.action) throw Error('封存回执操作类型不符。');
  if(raw.outcome==='COMMITTED'){
    const map=raw.idMap as Record<string,Record<string,unknown>>;
    if(Object.values(map.variants).some(v=>!projectCatalogId(v))||Object.values(map.addOns).some(v=>!projectCatalogId(v))||Object.values(map.displays).some(v=>typeof v!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(v)))throw Error('保存回执中的真实编号无效。');
  }
  return raw as unknown as WorkspaceReceipt;
}
/** A receipt acknowledges a command. Only a current, matching snapshot proves its resulting view. */
export function verifyWorkspaceReadback(snapshot: WorkspaceSnapshot, command: WorkspaceCommand, receipt: WorkspaceReceipt) {
  if (snapshot.priceMenuRevision !== receipt.priceMenuRevision || command.action === 'SAVE_SERVICE_WORKSPACE' && (snapshot.selectionRevision !== receipt.selectionRevision || snapshot.service?.id !== receipt.serviceId)) throw Error('保存回执已收到，但当前资料版本已变化；保留草稿供对比，不自动覆盖。');
  if (command.action === 'SAVE_SERVICE_WORKSPACE') {
    const s = snapshot.service!;
    for (const [key,value] of Object.entries({ ...command.service, ...command.policy })) if ((s as unknown as Record<string,unknown>)[key] !== value && !(key === 'description' && !value && !s.description)) throw Error('当前服务资料与保存内容不一致，请人工核对。');
    for (const [rows,kind] of [[command.variants,'variants'],[command.addOns,'addOns']] as const) for (const row of rows ?? []) {
      const id = 'id' in row ? row.id : receipt.idMap[kind][row.tempKey], actual = s[kind].find(v => v.id === id);
      if (!actual || Object.entries(row.changes).some(([key,value]) => (actual as unknown as Record<string,unknown>)[key] !== value && !(key === 'description' && !value && !('description' in actual && actual.description)))) throw Error('当前规格或附加项与保存内容不一致，请人工核对。');
    }
    for (const row of command.displays ?? []) {
      const id = 'id' in row ? receipt.idMap.displays[row.id] ?? row.id : receipt.idMap.displays[row.tempKey];
      const actual = snapshot.priceMenu.flatMap(g => g.items).find(item => item.id === id);
      if (!actual || Object.entries(row.changes).some(([key,value]) => key === 'titleMode' ? actual.pricing?.titleMode !== value : key === 'name' && row.changes.titleMode === 'AUTO' ? false : key === 'isVisible' ? (actual.isVisible !== false) !== value : (actual as unknown as Record<string,unknown>)[key] !== value && !(value === '' && !actual[key as keyof typeof actual]))) throw Error('当前顾客展示与保存内容不一致，请保留草稿核对。');
    }
  } else if (command.action === 'SAVE_LEGACY_DISPLAY') {
    const id = receipt.idMap.displays[command.itemId] ?? command.itemId, actual = snapshot.priceMenu.flatMap(g => g.items).find(row => row.id === id);
    if (!actual || actual.booking || Object.entries(command.changes).some(([key,value]) => key === 'isVisible' ? (actual.isVisible !== false) !== value : (actual as unknown as Record<string,unknown>)[key] !== value && !(value === '' && !actual[key as keyof typeof actual]))) throw Error('当前旧展示文字与保存内容不一致，请保留草稿核对。');
  } else if (command.action === 'REMOVE_MENU_DISPLAY' && snapshot.priceMenu.some(group=>group.items.some(row=>row.id===command.itemId))) {
    throw Error('该展示位置仍存在，不能确认移除完成。');
  }
}
/** Definitive request rejection only. Network/5xx/404 receipt and malformed success remain unknown. */
export function workspaceRejected(error: unknown) {
  if (!record(error)) return false;
  const status = typeof error.status === 'number' ? error.status : record(error.response) ? error.response.status : undefined;
  return typeof status === 'number' && [400,403,409,422].includes(status);
}
