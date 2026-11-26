import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CATALOG_CATEGORIES, CatalogCategory, CatalogGroup, ParsedCatalog } from './catalog-import.contract';

export const CATALOG_MAX_BYTES = 60 * 1024;
export const catalogId = (value: unknown): value is string => typeof value === 'string'
  && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
export const catalogRequestKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{8,100}$/.test(value);
export const catalogRecord = (value: any): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export const catalogStable = (value: any): string => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString()
  : catalogRecord(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const catalogDigest = (value: any) => createHash('sha256').update(catalogStable(value)).digest('hex');
export const catalogKey = (name: string, category: string) => JSON.stringify([name.normalize('NFKC').trim().toLowerCase(), category]);
export function catalogError(code: string, message: string, line?: number): never {
  throw new BadRequestException({ message: line ? `第${line}行：${message}` : message, catalogImportCode: code, ...(line ? { line } : {}) });
}

const HEADERS: Record<string, string> = {
  name: 'name', category: 'category', duration_minutes: 'duration_minutes', price_usd: 'price_usd', description: 'description',
  项目名称: 'name', 服务类型: 'category', '时长(分钟)': 'duration_minutes', '价格(USD)': 'price_usd', 说明: 'description',
};
const CATEGORY_ALIASES: Record<string, CatalogCategory> = {
  按摩: 'MASSAGE', 足疗: 'REFLEXOLOGY', 拔罐: 'CUPPING', 刮痧: 'SCRAPING', 头疗: 'HEAD_THERAPY', 其他: 'OTHER',
};
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
interface TextRow { cells: string[]; line: number; }

/** Find the first logical (possibly quoted/multiline) header. Delimiters inside
 * quoted cells never decide CSV vs TSV, and ambiguous unquoted headers fail. */
function delimiter(text: string): ',' | '\t' {
  let quoted = false, comma = 0, tab = 0, start = 0;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    }
    if (!quoted) {
      if (char === ',') comma++;
      if (char === '\t') tab++;
      if (char === '\r' || char === '\n' || char === undefined) {
        if (text.slice(start, i).trim()) {
          if ((comma > 0) === (tab > 0)) catalogError('DELIMITER_INVALID', '表头必须明确使用逗号CSV或制表符TSV');
          return comma > 0 ? ',' : '\t';
        }
        if (char === '\r' && text[i + 1] === '\n') i++;
        start = i + 1; comma = 0; tab = 0;
      }
    }
  }
  return catalogError('CSV_INVALID', '请提供完整表头和至少一行价目资料');
}

/** Strict RFC4180 cell state machine; track physical start lines for errors. */
function rows(text: string, separator: string): TextRow[] {
  const result: TextRow[] = [];
  let cells: string[] = [], value = '', quoted = false, closed = false, line = 1, rowLine = 1;
  const cell = () => { cells.push(value); value = ''; closed = false; };
  const row = () => {
    cell(); result.push({ cells, line: rowLine }); cells = [];
    if (result.length > 4000) catalogError('ROW_COUNT_INVALID', '空行过多，请清理后按每批100条拆分');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; }
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        value += '\n'; line++;
      } else value += char;
      continue;
    }
    if (char === '"') {
      if (value || closed) catalogError('CSV_INVALID', '引号只能包围完整单元格，内容内的引号须写成双引号', line);
      quoted = true;
    } else if (char === separator) cell();
    else if (char === '\r' || char === '\n') {
      row(); if (char === '\r' && text[i + 1] === '\n') i++;
      line++; rowLine = line;
    } else {
      if (closed) catalogError('CSV_INVALID', '闭合引号后只能接分隔符或换行', line);
      value += char;
    }
  }
  if (quoted) catalogError('CSV_INVALID', '单元格引号未闭合', rowLine);
  if (value || cells.length || closed) row();
  return result;
}

function normalizedText(value: string, max: number, required: boolean, multiline: boolean, label: string, line: number): string {
  const result = value.normalize('NFKC').trim();
  if ((required && !result) || result.length > max || control.test(result) || (!multiline && /[\r\n\t]/u.test(result))) {
    catalogError('TEXT_INVALID', `${label}${required ? '不能为空，且' : ''}最多${max}字，请移除不支持的控制字符`, line);
  }
  return result;
}

export function parseCatalog(shopId: unknown, input: unknown): ParsedCatalog {
  if (!catalogId(shopId)) catalogError('SHOP_ID_INVALID', '请选择有效门店');
  if (typeof input !== 'string' || !input.trim()) catalogError('TEXT_REQUIRED', '请粘贴CSV或Excel复制的TSV价目资料');
  if (Buffer.byteLength(input, 'utf8') > CATALOG_MAX_BYTES) catalogError('TEXT_TOO_LARGE', '每批资料最多60KiB，请拆分导入');
  const text = input.replace(/^\uFEFF/u, ''), parsedRows = rows(text, delimiter(text));
  // An all-empty row is ignored; partially empty rows remain invalid data.
  const nonempty = parsedRows.filter(row => row.cells.some(cell => !!cell.trim()));
  if (nonempty.length < 2) catalogError('ROWS_REQUIRED', '请提供表头和至少一行价目资料');
  const header = nonempty[0], headers = header.cells.map(cell => {
    const value = cell.normalize('NFKC').trim();
    return Object.prototype.hasOwnProperty.call(HEADERS, value) ? HEADERS[value] : '';
  });
  if (headers.some(h => !h) || new Set(headers).size !== headers.length
    || !['name', 'category', 'duration_minutes', 'price_usd'].every(h => headers.includes(h))) {
    catalogError('HEADERS_INVALID', '表头须包含name、category、duration_minutes、price_usd，可另加description；也可使用模板中的中文表头，不能重复或添加其它列', header.line);
  }
  const source = nonempty.slice(1);
  if (source.length > 100) catalogError('ROW_COUNT_INVALID', '每批最多100条非空价目资料');
  const groups = new Map<string, CatalogGroup>(); let duplicateRows = 0;
  for (const row of source) {
    if (row.cells.length !== headers.length) catalogError('ROW_WIDTH_INVALID', '单元格数量与表头不一致，请检查分隔符或引号', row.line);
    const data = Object.fromEntries(headers.map((h, index) => [h, row.cells[index]]));
    const name = normalizedText(data.name, 200, true, false, '项目名称', row.line);
    const description = normalizedText(data.description ?? '', 2000, false, true, '说明', row.line) || null;
    const categoryText = data.category.trim();
    const category = Object.prototype.hasOwnProperty.call(CATEGORY_ALIASES, categoryText) ? CATEGORY_ALIASES[categoryText] : categoryText;
    if (!(CATALOG_CATEGORIES as readonly string[]).includes(category)) catalogError('CATEGORY_INVALID', '服务类型须使用模板中的类别，不自动猜测', row.line);
    const durationText = data.duration_minutes.trim(), priceText = data.price_usd.trim();
    if (!/^\d{1,3}$/.test(durationText) || Number(durationText) < 5 || Number(durationText) > 240) catalogError('DURATION_INVALID', '时长须为5至240的整数分钟', row.line);
    if (!/^\d+(?:\.\d{1,2})?$/.test(priceText)) catalogError('PRICE_INVALID', '价格须为美元数字，最多两位小数；不接受货币符号、千分位、正负号或指数', row.line);
    const [dollars, fraction = ''] = priceText.split('.');
    const priceCents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
    if (priceCents < 1 || priceCents > 10000000) catalogError('PRICE_INVALID', '价格范围为0.01至100000.00美元', row.line);
    const durationMin = Number(durationText), key = catalogKey(name, category);
    let group = groups.get(key);
    if (!group) {
      group = { key, name, category: category as CatalogCategory, description, sourceRows: [], variants: [] };
      groups.set(key, group);
      if (groups.size > 50) catalogError('GROUP_COUNT_INVALID', '每批最多50个不同服务项目', row.line);
    }
    if (group.name !== name || group.description !== description) catalogError('GROUP_CONTENT_CONFLICT', '同名同类项目的名称和说明须完全一致，请核对同组各行', row.line);
    group.sourceRows.push(row.line);
    const previous = group.variants.find(item => item.durationMin === durationMin);
    if (previous) {
      if (previous.priceCents !== priceCents) catalogError('DURATION_PRICE_CONFLICT', '同一项目相同时长出现不同价格，请核对后再导入', row.line);
      previous.sourceRows.push(row.line); duplicateRows++;
    } else {
      group.variants.push({ name: `${durationMin} min`, durationMin, priceCents, sourceRows: [row.line] });
      if (group.variants.length > 10) catalogError('VARIANT_COUNT_INVALID', '同一项目每批最多10种不同时长', row.line);
    }
  }
  const normalizedGroups = [...groups.values()].map(group => ({ ...group, variants: group.variants.sort((a, b) => a.durationMin - b.durationMin) }));
  const normalized = { version: 1, shopId, inputRows: source.length, duplicateRows, groups: normalizedGroups };
  return { shopId, inputRows: source.length, duplicateRows, groups: normalizedGroups, packageDigest: catalogDigest(normalized) };
}
