import { MANAGED_MEDIA_PATH } from './mediaDraft';
import { formatPriceMenuTitle, matchesPriceMenuAutoTitle, normalizePriceMenuPricing, type PriceMenuPricing } from './priceMenuPricing';

export interface PriceMenuBooking { serviceId: string; variantId?: string; addOnId?: string; }
export type PriceMenuUnavailableReason = 'PARENT_PAUSED' | 'ITEM_PAUSED' | 'CONFIGURATION_REQUIRED';
export interface PriceMenuItem { id?: string; name: string; priceText: string; description?: string; imageUrl?: string; isVisible?: boolean; pricing?: PriceMenuPricing; bookingEnabled?: boolean; bookingAvailable?: boolean; bookingUnavailableReason?: PriceMenuUnavailableReason; booking?: PriceMenuBooking; newVariantOf?: string; reservedDurationMin?: number; bookingMode?: 'SINGLE' | 'COUPLE' | 'FOUR_HANDS'; }
export interface PriceMenuGroup { category: string; items: PriceMenuItem[]; }
export const PRICE_MENU_LIMITS = { groups: 100, items: 1000, category: 200, name: 300, priceText: 300, description: 2000, imageUrl: 500, bytes: 768 * 1024 } as const;
// Display-menu gallery only: exact versioned subjects, never arbitrary relative URLs.
const SERVICE_GALLERY_PATH = /^\/service-gallery\/v1\/[a-z][a-z0-9-]{0,79}\.webp$/;

export function priceMenuFromShop(shop: { priceMenu?: PriceMenuGroup[]; studioProfile?: Record<string, unknown> }): PriceMenuGroup[] {
  const value = Object.hasOwn(shop, 'priceMenu') ? shop.priceMenu : shop.studioProfile?.priceMenu;
  return Array.isArray(value) ? structuredClone(value) as PriceMenuGroup[] : [];
}

export function safePriceMenuImage(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw.length > PRICE_MENU_LIMITS.imageUrl || /[\s\\\u0000-\u001f\u007f]/u.test(raw)) return null;
  if (MANAGED_MEDIA_PATH.test(raw)) return raw;
  if (SERVICE_GALLERY_PATH.test(raw)) return raw;
  if (!/^https:\/\//i.test(raw)) return null;
  try { const url = new URL(raw); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && url.href.length <= PRICE_MENU_LIMITS.imageUrl ? url.href : null; }
  catch { return null; }
}

function text(value: unknown, field: string, max: number, required = false, multiline = false): string {
  if (typeof value !== 'string' || value.length > max || /<\/?[a-z][^>]*>/iu.test(value) || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)) throw new Error(`展示价目表${field}须为纯文本，最多 ${max} 字。`);
  const result = value.replace(/\r\n?/g, '\n').trim();
  if (required && !result) throw new Error(`请填写展示价目表${field}。`);
  return result;
}

export function validatePriceMenuBooking(value: unknown): PriceMenuBooking {
  const row = value as PriceMenuBooking;
  const id = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['serviceId','variantId','addOnId'].includes(key))
    || !id(row.serviceId) || row.variantId !== undefined && !id(row.variantId) || row.addOnId !== undefined && !id(row.addOnId) || row.variantId !== undefined && row.addOnId !== undefined) throw new Error('预约关联须使用有效的本店服务编号；规格和附加项目不能同时关联。');
  return { serviceId: row.serviceId, ...(row.variantId ? { variantId: row.variantId } : {}), ...(row.addOnId ? { addOnId: row.addOnId } : {}) };
}
/** Legacy wording remains display-only until booking is explicitly configured. */
export function validatePriceMenu(value: PriceMenuGroup[]): PriceMenuGroup[] {
  if (!Array.isArray(value) || value.length > PRICE_MENU_LIMITS.groups) throw new Error('展示价目表最多支持 100 个分组。');
  let count = 0;
  const result = value.map((group, index) => {
    if (!group || typeof group !== 'object' || Object.keys(group).some(key => !['category', 'items'].includes(key)) || !Array.isArray(group.items)) throw new Error('展示价目表分组格式无效。');
    const category = text(group.category, `第 ${index + 1} 组名称`, PRICE_MENU_LIMITS.category);
    const items = group.items.map((item, itemIndex) => {
      if (++count > PRICE_MENU_LIMITS.items) throw new Error('展示价目表最多支持 1000 个项目。');
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['id','name', 'priceText', 'description', 'imageUrl', 'isVisible', 'pricing','bookingEnabled','bookingAvailable','bookingUnavailableReason','booking','newVariantOf','reservedDurationMin','bookingMode'].includes(key))) throw new Error('展示价目表项目格式无效。');
      const label = `第 ${index + 1} 组第 ${itemIndex + 1} 项`;
      if (item.id !== undefined && (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id))) throw new Error('价目项目编号无效。');
      if (item.isVisible !== undefined && typeof item.isVisible !== 'boolean') throw new Error('顾客可见状态须为布尔值。');
      if (item.bookingEnabled !== undefined && typeof item.bookingEnabled !== 'boolean') throw new Error('请选择项目是否开放预约。');
      if (item.bookingAvailable !== undefined && typeof item.bookingAvailable !== 'boolean') throw new Error('当前可约状态须为布尔值。');
      if (item.bookingUnavailableReason !== undefined && !['PARENT_PAUSED','ITEM_PAUSED','CONFIGURATION_REQUIRED'].includes(item.bookingUnavailableReason)) throw new Error('当前不可约原因无效。');
      const booking = item.booking === undefined ? undefined : validatePriceMenuBooking(item.booking);
      const newVariantOf = item.newVariantOf === undefined ? undefined : /^item:[a-zA-Z0-9_-]{1,64}$/.test(item.newVariantOf) ? item.newVariantOf : validatePriceMenuBooking({ serviceId: item.newVariantOf }).serviceId;
      if (booking && newVariantOf) throw new Error('已有预约关联的项目不能同时作为新规格草稿。');
      if (item.bookingMode !== undefined && !['SINGLE','COUPLE','FOUR_HANDS'].includes(item.bookingMode)) throw new Error('请选择单人、情侣按摩或四手按摩预约方式。');
      if (item.reservedDurationMin !== undefined && (!Number.isInteger(item.reservedDurationMin) || item.reservedDurationMin < 5 || item.reservedDurationMin > 240)) throw new Error('预约占用时间须为5–240整数分钟。');
      const name = text(item.name, `${label}名称`, PRICE_MENU_LIMITS.name, true);
      const priceText = text(item.priceText, `${label}原价文字`, PRICE_MENU_LIMITS.priceText);
      let pricing: PriceMenuPricing | undefined;
      if (Object.hasOwn(item, 'pricing')) {
        pricing = normalizePriceMenuPricing(item.pricing);
        if (pricing.priceCents === null) throw new Error(`请填写展示价目表${label}价格。`);
        if (item.priceText !== '') throw new Error(`展示价目表${label}使用完整项目标题，请先明确转换旧项目价格文字。`);
        if (pricing.titleMode === 'AUTO' && !matchesPriceMenuAutoTitle(item.name, pricing)) throw new Error(`展示价目表${label}自动标题与所填时间、价格不一致，请核对。`);
      }
      const description = item.description === undefined ? '' : text(item.description, `${label}说明`, PRICE_MENU_LIMITS.description, false, true);
      const rawImage = item.imageUrl === undefined ? '' : text(item.imageUrl, `${label}图片地址`, PRICE_MENU_LIMITS.imageUrl);
      const imageUrl = rawImage ? safePriceMenuImage(rawImage) : '';
      if (rawImage && !imageUrl) throw new Error(`展示价目表${label}图片须从项目图库选择，或填写不含登录凭据的 HTTPS 地址或完整受管图片地址。`);
      if (item.bookingEnabled === true) {
        if (!booking && !pricing) throw new Error(`${label}请先设置项目类型、价格和时长。`);
        if (!booking && pricing?.kind !== 'ADD_ON' && !item.bookingMode) throw new Error(`${label}请明确选择单人、情侣按摩或四手按摩预约方式。`);
        if (pricing?.kind === 'ADD_ON' && !booking) throw new Error(`${label}附加项目须先选择主项目。`);
        if (pricing && pricing.kind !== 'TIMED' && pricing.kind !== 'ADD_ON' && item.reservedDurationMin === undefined && !booking) throw new Error(`${label}请明确填写预约占用时间。`);
      }
      return { name, priceText, ...(item.id ? { id: item.id } : {}), ...(item.isVisible !== undefined ? { isVisible: item.isVisible } : {}), ...(newVariantOf ? { newVariantOf } : {}), ...(item.bookingMode ? { bookingMode: item.bookingMode } : {}), ...(item.bookingEnabled !== undefined ? { bookingEnabled: item.bookingEnabled } : {}), ...(item.bookingAvailable !== undefined ? { bookingAvailable: item.bookingAvailable } : {}), ...(item.bookingUnavailableReason ? { bookingUnavailableReason: item.bookingUnavailableReason } : {}), ...(booking ? { booking } : {}), ...(item.reservedDurationMin !== undefined ? { reservedDurationMin: item.reservedDurationMin } : {}), ...(description ? { description } : {}), ...(imageUrl ? { imageUrl } : {}), ...(pricing ? { pricing } : {}) };
    });
    return { category, items };
  });
  const ids = result.flatMap(group => group.items.map(item => item.id).filter(Boolean));
  if (new Set(ids).size !== ids.length) throw new Error('价目项目编号重复，请重新载入后添加新项目。');
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PRICE_MENU_LIMITS.bytes) throw new Error('展示价目表总内容最多 768 KiB，请精简说明或分组项目。');
  return result;
}

export interface PriceMenuPasteIssue { line: number; column?: number; message: string; }
export interface PriceMenuPasteAnalysis { groups: PriceMenuGroup[]; issues: PriceMenuPasteIssue[]; errorCount: number; rows: number; format?: 'STRUCTURED' | 'LEGACY'; }
export const PRICE_MENU_PASTE_LIMITS = { characters: 2_500_000, issues: 20 } as const;
export const PRICE_MENU_TEMPLATE_FILENAME = 'massajoy-price-menu-template.tsv';
export const PRICE_MENU_TEMPLATE_CONTENT = '\uFEFF大类\t项目基础名称\t项目类型\t时长（分钟）\t价格（美元）\t说明\r\nBody Massage\tBody Massage\tTIMED\t30\t50\tPlease call to confirm availability.\r\nBody Massage\tBody Massage\tTIMED\t60\t80\tAsk the store for details.\r\n';

interface PasteCell { value: string; line: number; }
interface PasteRecord { line: number; cells: PasteCell[]; columns: number; invalid: boolean; quoted: boolean; nonWhitespace: boolean; }
const PASTE_FIELDS = ['分组', '项目名称', '原价文字', '说明'] as const;
const PASTE_MAX = [PRICE_MENU_LIMITS.category, PRICE_MENU_LIMITS.name, PRICE_MENU_LIMITS.priceText, PRICE_MENU_LIMITS.description] as const;
function pasteHeader(cells: PasteCell[]): boolean {
  if (cells.length < 3 || cells.length > 4) return false;
  const labels = cells.map(cell => cell.value.trim().toLowerCase());
  return ['分组', 'category'].includes(labels[0]) && ['项目', '项目名称', 'name'].includes(labels[1])
    && ['原价文字', '价格原文', 'pricetext', 'price_text', 'price text'].includes(labels[2])
    && (labels.length === 3 || ['说明', 'description'].includes(labels[3]));
}
function structuredPasteHeader(cells: PasteCell[]): boolean {
  if (cells.length !== 6) return false;
  const labels = cells.map(cell => cell.value.trim().toLowerCase());
  return ['大类', '分类', 'category'].includes(labels[0])
    && ['项目基础名称', '基础项目名称', 'base name', 'basename', 'base_name'].includes(labels[1])
    && ['项目类型', '类型', 'kind', 'type'].includes(labels[2])
    && ['时长（分钟）', '时长(分钟)', 'duration (minutes)', 'durationmin', 'duration_min'].includes(labels[3])
    && ['价格（美元）', '价格(美元)', 'price (usd)', 'priceusd', 'price_usd'].includes(labels[4])
    && ['说明', 'description'].includes(labels[5]);
}
function cellLine(cell: PasteCell, offset: number): number {
  let line = cell.line;
  for (let index = 0; index < offset; index++) if (cell.value[index] === '\n') line++;
  return line;
}

/** Excel TSV parser. Syntax errors invalidate the entire package; no malformed row is dropped. */
function scanPaste(input: string, record: (row: PasteRecord) => void, issue: (line: number, column: number, message: string) => void) {
  let line = 1, rowLine = 1, cellLine = 1, column = 1, value = '', cells: PasteCell[] = [];
  let state: 'START' | 'PLAIN' | 'QUOTED' | 'CLOSED' = 'START';
  let touched = false, quoted = false, invalid = false, fieldIssue = false, nonWhitespace = false;
  const syntax = (at: number, message: string) => {
    invalid = true;
    if (!fieldIssue) { issue(at, column, message); fieldIssue = true; }
  };
  const field = () => { if (cells.length < 7) cells.push({ value, line: cellLine }); value = ''; state = 'START'; fieldIssue = false; };
  const row = () => {
    field(); record({ line: rowLine, cells, columns: column, invalid, quoted, nonWhitespace });
    cells = []; column = 1; invalid = false; quoted = false; touched = false; nonWhitespace = false;
  };
  for (let index = input.charCodeAt(0) === 0xfeff ? 1 : 0; index < input.length; index++) {
    const char = input[index];
    const newline = char === '\r' || char === '\n';
    if (!/\s/u.test(char)) nonWhitespace = true;
    if (state === 'QUOTED') {
      if (char === '"') {
        if (input[index + 1] === '"') { value += '"'; index++; }
        else state = 'CLOSED';
      } else if (newline) {
        value += '\n'; if (char === '\r' && input[index + 1] === '\n') index++; line++;
      } else value += char;
      continue;
    }
    if (newline) {
      row(); if (char === '\r' && input[index + 1] === '\n') index++;
      line++; rowLine = line; cellLine = line;
    } else if (char === '\t') {
      touched = true; field(); column++; cellLine = line;
    } else if (state === 'START' && char === '"') {
      touched = true; quoted = true; state = 'QUOTED';
    } else {
      touched = true;
      if (state === 'CLOSED') syntax(line, '引号结束后只能使用 Tab 分列或换行，请检查引号转义。');
      else if (char === '"') syntax(line, '引号只能包住整个字段，字段内的双引号须写为两个双引号。');
      value += char; state = 'PLAIN';
    }
  }
  if (state === 'QUOTED') syntax(cellLine, '字段引号未闭合，请检查跨行内容和双引号转义。');
  if (touched || cells.length || value || state !== 'START') row();
}

/** Six-column templates provide explicit values. Legacy source wording is never parsed into numbers. */
function structuredPasteItem(row: PasteRecord, report: (line: number, column: number | undefined, message: string) => void): { category: string; item: PriceMenuItem } | null {
  const fields = ['大类', '项目基础名称', '项目类型', '时长（分钟）', '价格（美元）', '说明'];
  const limits = [PRICE_MENU_LIMITS.category, 200, 40, 20, 30, PRICE_MENU_LIMITS.description];
  let valid = true;
  const values = row.cells.map((cell, column) => {
    const value = cell.value.trim();
    if (column === 1 && !value) { report(cell.line, 2, '项目基础名称不能为空。'); valid = false; }
    else if (value.length > limits[column]) { report(cell.line, column + 1, `${fields[column]}最多 ${limits[column]} 字。`); valid = false; }
    else {
      const control = (column === 5 ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).exec(cell.value);
      if (control) { report(cellLine(cell, control.index), column + 1, `${fields[column]}含不允许的控制字符${column === 5 ? '。' : '、Tab 或换行。'}`); valid = false; }
      else {
        const html = /<\/?[a-z][^>]*>/iu.exec(value);
        if (html) {
          const leading = cell.value.length - cell.value.trimStart().length;
          report(cellLine(cell, leading + html.index), column + 1, `${fields[column]}须为纯文本，不能包含 HTML 标签。`); valid = false;
        }
      }
    }
    return value;
  });
  if (!valid) return null;
  const [category, baseName, rawKind, durationText, priceText, description] = values;
  const modes: Record<string, PriceMenuPricing['kind']> = {
    TIMED: 'TIMED', '固定时长': 'TIMED', '按时长': 'TIMED',
    PER_SESSION: 'PER_SESSION', '按次': 'PER_SESSION', '每次': 'PER_SESSION',
    VARIABLE: 'VARIABLE', '非固定时长': 'VARIABLE', '时长不固定': 'VARIABLE',
    ADD_ON: 'ADD_ON', '附加项目': 'ADD_ON', '加项': 'ADD_ON',
  };
  const kind = modes[rawKind.toUpperCase()];
  if (!kind) { report(row.cells[2].line, 3, '项目类型须为固定时长、按次、非固定时长、附加项目，或 TIMED、PER_SESSION、VARIABLE、ADD_ON。'); valid = false; }
  let durationMin: number | null = null;
  if (kind === 'TIMED') {
    if (!/^[1-9]\d{0,3}$/u.test(durationText) || Number(durationText) > 1440) { report(row.cells[3].line, 4, '固定时长须填写 1–1440 的整数分钟。'); valid = false; }
    else durationMin = Number(durationText);
  } else if (kind && durationText) { report(row.cells[3].line, 4, '按次、非固定时长和附加项目的时长列须留空。'); valid = false; }
  let priceCents = 0;
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/u.test(priceText)) { report(row.cells[4].line, 5, '价格须填写 0–999999.99 美元，最多两位小数，不带货币符号。'); valid = false; }
  else { const [whole, fraction = ''] = priceText.split('.'); priceCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0')); }
  if (!valid || !kind) return null;
  const pricing = normalizePriceMenuPricing({ kind, baseName, durationMin, priceCents, titleMode: 'AUTO' });
  return { category, item: { name: formatPriceMenuTitle(pricing), priceText: '', ...(description ? { description } : {}), pricing } };
}

/** Report spreadsheet column numbers and original physical lines, including quoted multiline cells. */
export function analyzePriceMenuPaste(input: string): PriceMenuPasteAnalysis {
  const issues: PriceMenuPasteIssue[] = [], groups: PriceMenuGroup[] = [], byCategory = new Map<string, PriceMenuGroup>();
  let errorCount = 0, rows = 0, firstNonempty = true, bytes = 2, sizeReported = false, structured = false;
  const report = (line: number, column: number | undefined, message: string) => {
    errorCount++;
    if (issues.length < PRICE_MENU_PASTE_LIMITS.issues) issues.push({ line, ...(column === undefined ? {} : { column }), message });
  };
  if (typeof input !== 'string' || input.length > PRICE_MENU_PASTE_LIMITS.characters) {
    report(1, undefined, '粘贴内容过大或格式无效，请分批粘贴纯文本表格。');
    return { groups: [], issues, errorCount, rows };
  }
  scanPaste(input, row => {
    if (!row.invalid && !row.quoted && !row.nonWhitespace) return;
    const newHeader = !row.invalid && structuredPasteHeader(row.cells);
    const header = newHeader || !row.invalid && pasteHeader(row.cells);
    if (header) {
      if (!firstNonempty) report(row.line, undefined, '表头只能放在第一条非空记录，请删除重复表头。');
      else structured = newHeader;
      firstNonempty = false; return;
    }
    firstNonempty = false; rows++;
    if (row.invalid) return;
    if (structured ? row.columns !== 6 : row.columns < 3 || row.columns > 4) {
      report(row.line, structured ? row.columns < 6 ? row.columns + 1 : 7 : row.columns < 3 ? row.columns + 1 : 5, structured
        ? '新版模板每条记录须为 6 列，列之间用 Tab 分隔；含 Tab 或换行的字段须使用双引号。'
        : '每条记录须为 3–4 列；新版 6 列模板须保留首行表头。列之间用 Tab 分隔，含 Tab 或换行的字段须使用双引号。');
      return;
    }
    if (structured) {
      if (rows > PRICE_MENU_LIMITS.items) { report(row.line, undefined, '展示价目表最多支持 1000 个项目，请分批整理。'); return; }
      const parsed = structuredPasteItem(row, report);
      if (!parsed) return;
      let group = byCategory.get(parsed.category);
      if (!group) {
        if (groups.length >= PRICE_MENU_LIMITS.groups) { report(row.cells[0].line, 1, '展示价目表最多支持 100 个分组。'); return; }
        group = { category: parsed.category, items: [] }; byCategory.set(parsed.category, group);
        bytes += new TextEncoder().encode(JSON.stringify(group)).length + (groups.length ? 1 : 0); groups.push(group);
      }
      bytes += new TextEncoder().encode(JSON.stringify(parsed.item)).length + (group.items.length ? 1 : 0); group.items.push(parsed.item);
      if (bytes > PRICE_MENU_LIMITS.bytes && !sizeReported) { report(row.line, undefined, '展示价目表总内容最多 768 KiB，请精简说明或分组项目。'); sizeReported = true; }
      return;
    }
    let valid = true;
    const values = row.cells.map((cell, column) => {
      const text = cell.value.trim(), label = PASTE_FIELDS[column];
      if (column === 1 && !text) { report(cell.line, column + 1, '项目名称不能为空。'); valid = false; }
      else if (text.length > PASTE_MAX[column]) { report(cell.line, column + 1, `${label}最多 ${PASTE_MAX[column]} 字。`); valid = false; }
      else {
        const invalidControl = (column === 3 ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).exec(cell.value);
        if (invalidControl) { report(cellLine(cell, invalidControl.index), column + 1, `${label}含不允许的控制字符${column === 3 ? '。' : '、Tab 或换行。'}`); valid = false; }
        else {
          const html = /<\/?[a-z][^>]*>/iu.exec(text);
          if (html) {
            const leading = cell.value.length - cell.value.trimStart().length;
            report(cellLine(cell, leading + html.index), column + 1, `${label}须为纯文本，不能包含 HTML 标签。`); valid = false;
          }
        }
      }
      return text;
    });
    if (rows > PRICE_MENU_LIMITS.items) { report(row.line, undefined, '展示价目表最多支持 1000 个项目，请分批整理。'); return; }
    if (!valid) return;
    const [category, name, priceText, description] = values;
    let group = byCategory.get(category);
    if (!group) {
      if (groups.length >= PRICE_MENU_LIMITS.groups) { report(row.cells[0].line, 1, '展示价目表最多支持 100 个分组。'); return; }
      group = { category, items: [] }; byCategory.set(category, group);
      bytes += new TextEncoder().encode(JSON.stringify(group)).length + (groups.length ? 1 : 0); groups.push(group);
    }
    const item: PriceMenuItem = { name, priceText, ...(description ? { description } : {}) };
    bytes += new TextEncoder().encode(JSON.stringify(item)).length + (group.items.length ? 1 : 0); group.items.push(item);
    if (bytes > PRICE_MENU_LIMITS.bytes && !sizeReported) { report(row.line, undefined, '展示价目表总内容最多 768 KiB，请精简说明或分组项目。'); sizeReported = true; }
  }, (line, column, message) => report(line, column, message));
  if (rows === 0 && errorCount === 0) report(1, undefined, '请先粘贴至少一个价目项目。');
  return { groups: errorCount ? [] : groups, issues, errorCount, rows, ...(structured ? { format: 'STRUCTURED' as const } : {}) };
}

/** Compatibility wrapper: success returns the full package; any issue throws without partial rows. */
export function parsePriceMenuPaste(input: string): PriceMenuGroup[] {
  const analysis = analyzePriceMenuPaste(input);
  if (analysis.errorCount) {
    const issue = analysis.issues[0];
    throw new Error(`粘贴第 ${issue.line} 行${issue.column === undefined ? '' : `第 ${issue.column} 列`}：${issue.message}${analysis.errorCount > 1 ? `（共 ${analysis.errorCount} 处错误）` : ''}`);
  }
  return analysis.groups;
}

/** Append explicitly, preserving existing groups, items and all non-menu shop data. */
export function appendPriceMenu(current: PriceMenuGroup[], addition: PriceMenuGroup[]): PriceMenuGroup[] {
  const next = structuredClone(current);
  for (const group of addition) {
    const existing = next.find(item => item.category === group.category);
    if (existing) existing.items.push(...structuredClone(group.items));
    else next.push(structuredClone(group));
  }
  return validatePriceMenu(next);
}
