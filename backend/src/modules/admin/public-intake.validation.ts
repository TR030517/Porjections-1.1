import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { IntakeIssue } from './public-intake.contract';

export const INTAKE_MAX_BYTES = 60 * 1024;
export const INTAKE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DB_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const isRecord = (value: any): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export const issue = (code: string, message: string, field?: string): IntakeIssue => ({ code, message, ...(field ? { field } : {}) });
export function intakeError(code: string, message: string): never { throw new BadRequestException({ message, publicIntakeCode: code }); }
export function intakeStable(value: any): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export const intakeDigest = (value: any) => createHash('sha256').update(intakeStable(value)).digest('hex');
export const intakeId = (value: any): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
export const intakeRequestKey = (value: any): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{8,100}$/.test(value);
const shape = (v: any, allowed: string[], required: string[] = allowed) => isRecord(v) && Object.keys(v).every(k => allowed.includes(k)) && required.every(k => own(v,k));
const text = (value: any, max: number, multiline = false) => typeof value === 'string' && !!value.trim() && value.length <= max && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value);
function unsafe(value: any, depth = 0): boolean {
  if (depth > 12) return true;
  if (Array.isArray(value)) return value.some(item => unsafe(item,depth+1));
  if (!isRecord(value)) return !(value === null || ['string','boolean'].includes(typeof value) || typeof value==='number'&&Number.isFinite(value));
  return Object.entries(value).some(([key,child]) => ['__proto__','constructor','prototype'].includes(key)
    || /password|secret|token|cookie|credential|authorization|customer|userId|ownerId/i.test(key) || unsafe(child,depth+1));
}
function evidence(value: unknown) {
  if (typeof value !== 'string' || !text(value,2048)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'app.asianmassagebook.com' && !url.port && !url.username && !url.password && !url.search
      && ['/admin','/admin/','/merchant','/merchant/'].includes(url.pathname) && /^#\/[a-zA-Z0-9/_-]+$/.test(url.hash) ? url : null;
  } catch {
    return null;
  }
}
export interface IntakeSource {
  sourceId: string; sourceUrls: string[]; targetShopId: string; name: string; shortName: string; description?: string; businessHours?: Record<string, any>;
  issues: IntakeIssue[]; warnings: IntakeIssue[]; rawCatalogItems: number;
}
export function parseIntakePackage(input: any): { packageDigest: string; batchId: string; capturedAt: string; sources: IntakeSource[] } {
  let bytes: string;
  try { bytes = JSON.stringify(input); } catch { return intakeError('PACKAGE_INVALID','请选择有效的JSON资料包'); }
  if (!bytes || Buffer.byteLength(bytes,'utf8') > INTAKE_MAX_BYTES) intakeError('PACKAGE_TOO_LARGE','资料包最多60KiB，请按最多20家门店拆分');
  if (!shape(input,['schemaVersion','sourceSystem','batchId','capturedAt','shops']) || input.schemaVersion !== 1 || input.sourceSystem !== 'massajoy1'
    || typeof input.batchId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(input.batchId)) intakeError('PACKAGE_CONTRACT_INVALID','资料包须使用Massajoy1.0公开资料格式schemaVersion 1');
  const validDate = typeof input.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.capturedAt) && Number.isFinite(Date.parse(input.capturedAt));
  if (!validDate || ![new Date(input.capturedAt).toISOString(),new Date(input.capturedAt).toISOString().replace('.000Z','Z')].includes(input.capturedAt)) intakeError('CAPTURED_AT_INVALID','采集时间须为有效UTC ISO时间');
  if (!Array.isArray(input.shops) || !input.shops.length || input.shops.length > 20) intakeError('SHOP_COUNT_INVALID','每批请提供1至20家明确匹配的现有门店');
  const sources = input.shops.map((row: any) => parseSource(row));
  for (const key of ['sourceId','targetShopId'] as const) {
    const counts = new Map<string,number>(); for (const row of sources) if (row[key]) counts.set(row[key],(counts.get(row[key]) ?? 0)+1);
    for (const row of sources) if ((counts.get(row[key]) ?? 0)>1) row.issues.push(issue('DUPLICATE_MAPPING',key==='sourceId'?'同批来源门店ID重复':'同批目标门店ID重复',key));
  }
  return { packageDigest:intakeDigest(input), batchId:input.batchId, capturedAt:input.capturedAt, sources };
}
function parseSource(row: any): IntakeSource {
  const result: IntakeSource = {sourceId:typeof row?.sourceId==='string'?row.sourceId:'',sourceUrls:[],targetShopId:typeof row?.targetShopId==='string'?row.targetShopId:'',name:typeof row?.match?.name==='string'?row.match.name:'',shortName:typeof row?.match?.shortName==='string'?row.match.shortName:'',issues:[],warnings:[],rawCatalogItems:0};
  if (!shape(row,['sourceEntity','sourceId','targetShopId','match','sourceUrls','description','businessHours','timezone','phone','rawCatalog'],['sourceEntity','sourceId','targetShopId','match','sourceUrls']) || unsafe(row)) {
    result.issues.push(issue('SHOP_SHAPE_INVALID','门店行包含不支持的字段、敏感字段或嵌套内容')); return result;
  }
  if (row.sourceEntity!=='merchant' || !intakeId(row.sourceId)) result.issues.push(issue('SOURCE_ID_INVALID','请填写1.0商家门店的明确数字ID','sourceId'));
  if (!intakeId(row.targetShopId)) result.issues.push(issue('TARGET_ID_INVALID','请填写2.0现有门店数字ID','targetShopId'));
  if (!shape(row.match,['name','shortName']) || !text(row.match.name,200) || !text(row.match.shortName,100) || !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(row.match.shortName)) result.issues.push(issue('MATCH_INVALID','请提供目标店的准确名称及短名','match'));
  const sourceUrls: unknown = row.sourceUrls;
  if (!Array.isArray(sourceUrls) || !sourceUrls.length || sourceUrls.length > 5) {
    result.issues.push(issue('SOURCE_EVIDENCE_INVALID', '请提供1至5个1.0后台公开经营资料的来源页面链接', 'sourceUrls'));
  } else {
    const urls = sourceUrls.map(evidence);
    const validUrls = urls.filter((url): url is URL => url !== null);
    result.sourceUrls = validUrls.map(url => url.href);
    if (validUrls.length !== urls.length) result.issues.push(issue('SOURCE_EVIDENCE_INVALID', '来源链接须指向1.0后台公开经营资料页面，请修正后重新预览', 'sourceUrls'));
    if (intakeId(row.sourceId)) {
      for (const url of validUrls) {
        // A list or the current merchant's settings can be valid evidence without a merchant ID.
        const merchantId = url.hash.match(/^#\/merchants?\/(\d+)\/?$/)?.[1]?.replace(/^0+(?=\d)/, '');
        if (merchantId && merchantId !== row.sourceId) {
          result.issues.push(issue('SOURCE_MERCHANT_MISMATCH', `来源链接中的1.0门店编号 #${merchantId} 与填写的来源编号 #${row.sourceId} 不一致，请核对来源门店与链接后重新预览`, 'sourceUrls'));
        }
      }
    }
  }
  if (own(row,'description') && row.description !== '' && !(typeof row.description==='string' && !row.description.trim())) {
    if (!text(row.description,20000,true)) result.issues.push(issue('DESCRIPTION_INVALID','简介需为不超过20000字的普通文本','description'));
    else result.description=row.description.trim();
  }
  if (own(row,'businessHours')) {
    try { result.businessHours = sourceHours(row.businessHours); }
    catch { result.issues.push(issue('HOURS_INVALID','营业时间须包含完整七日且至少一天营业，每日最多四段，使用不重叠且递增的HH:MM；休息日用空数组','businessHours')); }
  }
  if (own(row,'rawCatalog')) {
    if (!Array.isArray(row.rawCatalog) || row.rawCatalog.length>100) result.issues.push(issue('CATALOG_SHAPE_INVALID','原价目仅允许最多100条供核对的数组','rawCatalog'));
    else result.rawCatalogItems=row.rawCatalog.length;
    if (result.rawCatalogItems) result.warnings.push(issue('CATALOG_NOT_IMPORTED','原价目仅供后续核对，本次不导入价格、规格或启用服务','rawCatalog'));
  }
  for (const field of ['timezone','phone']) if (own(row,field)) result.warnings.push(issue('FIELD_NOT_IMPORTED',field==='timezone'?'本次不导入或推断时区，请在门店工作室核对':'本次不导入或推断电话，请在门店工作室核对',field));
  if (!result.description && !result.businessHours) result.issues.push(issue('NO_IMPORTABLE_FIELDS','至少填写真实简介或完整七日营业时间，不提交空模板'));
  return result;
}
function sourceHours(value: any) {
  if (!shape(value,INTAKE_DAYS)) throw Error('invalid');
  if(!INTAKE_DAYS.some(day=>Array.isArray(value[day])&&value[day].length>0)) throw Error('empty-week');
  return Object.fromEntries(INTAKE_DAYS.map((day,index) => {
    const rows=value[day];if(!Array.isArray(rows)||rows.length>4) throw Error('invalid');
    let previous='';const periods=rows.map((p:any)=>{
      const valid=(v:any)=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
      if(!shape(p,['start','end'])||!valid(p.start)||!valid(p.end)||p.start>=p.end||p.start<previous) throw Error('invalid');
      previous=p.end;return {open:p.start,close:p.end,closed:false};
    });
    return [DB_DAYS[index],periods.length>1?periods:periods[0]??{closed:true}];
  }));
}
const PLACEHOLDER = Object.fromEntries(['周一','周二','周三','周四','周五','周六','周日'].map(day=>[day,{open:false,start:'',end:''}]));
export const intakeEmpty = (v:any) => v==null || typeof v==='string' && !v.trim();
export const intakeEmptyHours = (v:any) => v==null || intakeStable(v)==='{}' || intakeStable(v)===intakeStable(PLACEHOLDER);
