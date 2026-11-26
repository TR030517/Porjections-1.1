// Offline, explicit intermediate format. Never reads credentials, a database or raw legacy SQL.
import {createHash} from 'node:crypto';

export const STAGING_COLLECTIONS = ['identities','shops','services','variants','therapists','qualifications','giftProducts','historicalBookings','historicalPayments','unusedEntitlements'];
export const STAGING_VERSION = 'massajoy-staging-plan-v2';
const MAX_ROWS = 10000, MAX_TOTAL = 50000, MAX_ISSUES = 2000;
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const FIELDS = {
  identities: ['source','pseudonym','role','status'],
  shops: ['source','owner','displayLabel','shortName','status','timezone','businessHours'],
  services: ['source','shop','displayLabel','category','durationMin','price','currency','priceBasis','active'],
  variants: ['source','service','displayLabel','durationMin','price','currency','priceBasis','active'],
  therapists: ['source','shop','pseudonym','active'],
  qualifications: ['source','therapist','service'],
  giftProducts: ['source','shop','displayLabel','totalUses','validDays','price','currency','active'],
  historicalBookings: ['source','user','shop','services','status','timezone','startAt','endAt','amounts','currency'],
  historicalPayments: ['source','booking','shop','owner','kind','parent','provider','ownership','status','amount','currency','occurredAt','evidenceDigest'],
  unusedEntitlements: ['source','user','shop','product','sourceKind','status','totalUses','remainingUses','issuedAt','expiresAt','timezone','funding'],
};
const MONEY_FIELDS = ['base','discount','fee','tip','tax','total','paid','refunded'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const opaqueId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const table = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value);
const refValid = value => object(value) && Object.keys(value).length === 2 && table(value.table) && opaqueId(value.id);
const refKey = value => JSON.stringify([value.table,value.id]);
// Explicit two-decimal currencies only. Never reinterpret zero/three-decimal currency amounts as cents.
const currencyValid = value => ['usd','eur','gbp','cad','aud','nzd','cny','hkd','sgd'].includes(value);
const digestValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (object(value) && !Object.keys(value).some(key => ['__proto__','constructor','prototype'].includes(key))) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  throw new Error('NON_CANONICAL_JSON');
}
export const stagingHash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const sourceMappingId = (system, source) => stagingHash(['legacy-staging-source-v2',system,source.table,source.id]);
function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^([1-9]\d{3}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
  if (!match || match[6] === '-00:00' || /[+-]14:(?!00)/.test(match[6])) return null;
  const day = Date.parse(match[1] + 'T00:00:00Z'), instant = Date.parse(value);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0,10) === match[1] && Number.isFinite(instant)
    ? {instant, local:`${match[1]}T${match[2]}:${match[3]}:${match[4]}`} : null;
}
function zone(value) {
  if (typeof value !== 'string' || value.length > 80 || !(value === 'UTC' || value.includes('/'))) return false;
  try { new Intl.DateTimeFormat('en-US',{timeZone:value}).format(0); return true; } catch { return false; }
}
function zoned(stamp, timezone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(stamp).map(part => [part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
/** No floating conversion or rounding. Original amount text/unit remains in the payload. */
export function exactMoney(value) {
  if (!object(value) || Object.keys(value).length !== 3 || !['major','minor'].includes(value.unit) || typeof value.original !== 'string'
    || !Number.isSafeInteger(value.cents) || value.cents < 0 || value.cents > 999999999999) return null;
  let expected;
  if (value.unit === 'minor' && /^(0|[1-9]\d{0,11})$/.test(value.original)) expected = BigInt(value.original);
  else if (value.unit === 'major' && /^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value.original)) {
    const [whole,fraction=''] = value.original.split('.'); expected = BigInt(whole)*100n + BigInt(fraction.padEnd(2,'0'));
  } else return null;
  return expected === BigInt(value.cents) ? expected : null;
}

export function planLegacyStaging(input) {
  const issues=[], issueCounts={}, rows={}, maps={}, shops=new Map(); let blockers=0;
  function issue(code,collection='package',row,field) { blockers++; issueCounts[code]=(issueCounts[code]??0)+1; if(issues.length<MAX_ISSUES) issues.push({code,collection,...(row===undefined?{}:{row}),...(field?{field}:{})}); }
  function shape(value,allowed,collection,row) { if(!object(value)){issue('OBJECT_REQUIRED',collection,row);return false;} if(Object.keys(value).some(key=>!allowed.includes(key))){issue('UNSUPPORTED_FIELD',collection,row);return false;} if(allowed.some(key=>!Object.hasOwn(value,key))) {issue('REQUIRED_FIELD_MISSING',collection,row);return false;} return true; }
  function choose(value,values,field,c,r){if(!values.includes(value)) issue('ENUM_OR_SEMANTICS_UNMAPPED',c,r,field);}
  function integer(value,min,max,field,c,r){if(!Number.isSafeInteger(value)||value<min||value>max) issue('INTEGER_INVALID',c,r,field);}
  function label(value,field,c,r){if(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u001f]/.test(value)) issue('LABEL_INVALID',c,r,field);}
  function pseudo(value,c,r){if(typeof value!=='string'||!/^anon_[A-Za-z0-9_-]{1,59}$/.test(value)) issue('PSEUDONYM_REQUIRED',c,r);}
  function money(value,field,c,r){if(exactMoney(value)===null) issue('EXACT_MONEY_REQUIRED',c,r,field);}
  function curr(value,c,r){if(!currencyValid(value))issue('CURRENCY_REQUIRED_NO_CONVERSION',c,r,'currency');}
  function at(value,timezone,field,c,r){const stamp=timestamp(value);if(!stamp){issue('EXPLICIT_TIMESTAMP_REQUIRED',c,r,field);return null;}if(zone(timezone)&&zoned(stamp.instant,timezone)!==stamp.local)issue('TIMEZONE_OFFSET_MISMATCH',c,r,field);return stamp.instant;}
  function reference(value,target,field,c,r){if(!refValid(value)){issue('EXPLICIT_SOURCE_REFERENCE_REQUIRED',c,r,field);return null;}const found=maps[target]?.get(refKey(value));if(!found)issue('ORPHAN_SOURCE_REFERENCE',c,r,field);return found??null;}
  function sameShop(a,b,c,r){if(a&&b&&refValid(a)&&refValid(b)&&refKey(a)!==refKey(b))issue('CROSS_SHOP_OR_AMBIGUOUS_OWNERSHIP',c,r);}
  if(!shape(input,['schemaVersion','format','source',...STAGING_COLLECTIONS],'package')) input={};
  if(input.schemaVersion!==2||input.format!=='massajoy-legacy-staging-export')issue('STAGING_FORMAT_REQUIRED');
  const source=object(input.source)?input.source:{};
  shape(input.source,['system','datasetKind','piiRemoved','scope','exportedAt','unsupportedDomains'],'source');
  choose(source.system,['Massajoy1.0','Massajoy1.5'],'system','source');
  choose(source.datasetKind,['synthetic','redacted'],'datasetKind','source');
  if(source.piiRemoved!==true)issue('REDACTION_DECLARATION_REQUIRED','source');
  if(source.scope!=='selected-domains-staging-only')issue('LIVE_OR_FULL_MIGRATION_UNSUPPORTED','source');
  if(!timestamp(source.exportedAt))issue('EXPLICIT_EXPORT_TIMESTAMP_REQUIRED','source');
  if(!Array.isArray(source.unsupportedDomains)||source.unsupportedDomains.length)issue('UNSUPPORTED_DOMAIN_PRESENT','source');
  const allKeys=new Set(); let total=0;
  for(const c of STAGING_COLLECTIONS){
    maps[c]=new Map();rows[c]=[];
    if(!Array.isArray(input[c])){issue('COLLECTION_REQUIRED',c);continue;}
    total+=input[c].length;if(input[c].length>MAX_ROWS){issue('COLLECTION_LIMIT_EXCEEDED',c);continue;}
    for(const [index,row]of input[c].entries()){
      if(!shape(row,FIELDS[c],c,index+1))continue;
      rows[c].push(row);
      if(!refValid(row.source)){issue('EXPLICIT_SOURCE_ID_REQUIRED',c,index+1);continue;}
      const key=refKey(row.source);if(allKeys.has(key))issue('DUPLICATE_SOURCE_ID',c,index+1);else {allKeys.add(key);maps[c].set(key,row);}
    }
  }
  if(total>MAX_TOTAL)issue('PACKAGE_LIMIT_EXCEEDED');
  if(!rows.identities.length||!rows.shops.length)issue('IDENTITY_AND_SHOP_REQUIRED');
  for(const [i,row]of rows.identities.entries()){pseudo(row.pseudonym,'identities',i+1);choose(row.role,['CUSTOMER','MERCHANT','ADMIN'],'role','identities',i+1);choose(row.status,['ACTIVE','SUSPENDED','DELETED'],'status','identities',i+1);}
  const aliasKeys=new Set();
  for(const [i,row]of rows.shops.entries()){
    const r=i+1,owner=reference(row.owner,'identities','owner','shops',r);if(owner&&owner.role!=='MERCHANT')issue('OWNER_ROLE_UNMAPPED','shops',r);
    label(row.displayLabel,'displayLabel','shops',r);choose(row.status,['PENDING','APPROVED','REJECTED','SUSPENDED'],'status','shops',r);
    if(!zone(row.timezone))issue('IANA_TIMEZONE_REQUIRED','shops',r,'timezone');
    if(row.shortName!==null){if(typeof row.shortName!=='string'||!/^([a-z0-9][a-z0-9-]{0,62})$/.test(row.shortName))issue('SHORT_NAME_UNMAPPED','shops',r);else if(aliasKeys.has(row.shortName))issue('DUPLICATE_SHORT_NAME','shops',r);else aliasKeys.add(row.shortName);}
    if(shape(row.businessHours,DAYS,'shops',r))for(const day of DAYS){let previous=0;const intervals=row.businessHours[day];if(!Array.isArray(intervals)||intervals.length>8){issue('HOURS_UNMAPPED','shops',r);continue;}for(const interval of intervals){if(!shape(interval,['open','close'],'shops',r))continue;const min=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):null;const a=min(interval.open),b=interval.close==='24:00'?1440:min(interval.close);if(a===null||b===null||a>=b||a<previous)issue('HOURS_UNMAPPED','shops',r);previous=b??1440;}}
    if(refValid(row.source))shops.set(refKey(row.source),row);
  }
  for(const c of ['services','variants','giftProducts'])for(const [i,row]of rows[c].entries()){
    const r=i+1;label(row.displayLabel,'displayLabel',c,r);money(row.price,'price',c,r);curr(row.currency,c,r);if(typeof row.active!=='boolean')issue('ACTIVE_FLAG_REQUIRED',c,r);
    if(c==='variants'){const service=reference(row.service,'services','service',c,r);if(service&&row.currency!==service.currency)issue('CURRENCY_MISMATCH',c,r);}
    else reference(row.shop,'shops','shop',c,r);
    if(c==='giftProducts'){integer(row.totalUses,1,10000,'totalUses',c,r);integer(row.validDays,1,3650,'validDays',c,r);}
    else {integer(row.durationMin,1,480,'durationMin',c,r);choose(row.priceBasis,['PER_PERSON','PER_BOOKING'],'priceBasis',c,r);if(c==='services')choose(row.category,['MASSAGE','REFLEXOLOGY','CUPPING','SCRAPING','HEAD_THERAPY','OTHER'],'category',c,r);}
  }
  for(const [i,row]of rows.therapists.entries()){reference(row.shop,'shops','shop','therapists',i+1);pseudo(row.pseudonym,'therapists',i+1);if(typeof row.active!=='boolean')issue('ACTIVE_FLAG_REQUIRED','therapists',i+1);}
  const qualifications=new Set();
  for(const [i,row]of rows.qualifications.entries()){
    const therapist=reference(row.therapist,'therapists','therapist','qualifications',i+1),service=reference(row.service,'services','service','qualifications',i+1);
    if(therapist&&service){sameShop(therapist.shop,service.shop,'qualifications',i+1);const key=canonicalJson([row.therapist,row.service]);if(qualifications.has(key))issue('DUPLICATE_QUALIFICATION','qualifications',i+1);qualifications.add(key);}
  }
  for(const [i,row]of rows.historicalBookings.entries()){
    const c='historicalBookings',r=i+1,user=reference(row.user,'identities','user',c,r);reference(row.shop,'shops','shop',c,r);if(user&&user.role!=='CUSTOMER')issue('CUSTOMER_ROLE_REQUIRED',c,r);
    choose(row.status,['COMPLETED','CANCELLED','REFUNDED'],'status',c,r);if(!zone(row.timezone))issue('HISTORICAL_TIMEZONE_REQUIRED',c,r);
    const start=at(row.startAt,row.timezone,'startAt',c,r),end=at(row.endAt,row.timezone,'endAt',c,r);if(start!==null&&end!==null&&end<=start)issue('INTERVAL_INVALID',c,r);
    if(end!==null&&timestamp(source.exportedAt)&&end>timestamp(source.exportedAt).instant)issue('NON_HISTORICAL_BOOKING_UNSUPPORTED',c,r);
    if(!Array.isArray(row.services)||!row.services.length||row.services.length>100)issue('SERVICE_REFERENCES_REQUIRED',c,r);else for(const value of row.services){const service=reference(value,'services','services',c,r);if(service)sameShop(row.shop,service.shop,c,r);}
    curr(row.currency,c,r);
    if(shape(row.amounts,MONEY_FIELDS,c,r)){
      for(const key of MONEY_FIELDS)money(row.amounts[key],key,c,r);
      const m=Object.fromEntries(MONEY_FIELDS.map(key=>[key,exactMoney(row.amounts[key])]));
      if(Object.values(m).every(v=>v!==null)){
        if(m.discount>m.base||m.base-m.discount+m.fee+m.tip+m.tax!==m.total||m.refunded>m.paid||m.paid>m.total)issue('HISTORICAL_MONEY_MISMATCH',c,r);
        if(row.status==='COMPLETED'&&m.paid!==m.total||row.status==='CANCELLED'&&m.paid!==m.refunded||row.status==='REFUNDED'&&(m.paid===0n||m.paid!==m.refunded))issue('HISTORICAL_STATUS_MONEY_CONFLICT',c,r);
      }
    }
  }
  const evidence=new Set(),ledgers=new Map();
  for(const [i,row]of rows.historicalPayments.entries()){
    const c='historicalPayments',r=i+1,booking=reference(row.booking,'historicalBookings','booking',c,r),shop=reference(row.shop,'shops','shop',c,r),owner=reference(row.owner,'identities','owner',c,r);
    if(booking){sameShop(row.shop,booking.shop,c,r);if(row.currency!==booking.currency)issue('CURRENCY_MISMATCH',c,r);}
    if(shop&&owner&&refValid(shop.owner)&&refValid(row.owner)&&refKey(shop.owner)!==refKey(row.owner))issue('PAYMENT_OWNER_MISMATCH',c,r);
    choose(row.ownership,['DIRECT_SHOP'],'ownership',c,r);choose(row.provider,['square','stripe','offline'],'provider',c,r);choose(row.status,['SUCCEEDED','FAILED'],'status',c,r);choose(row.kind,['PAYMENT','REFUND'],'kind',c,r);
    money(row.amount,'amount',c,r);curr(row.currency,c,r);const when=at(row.occurredAt,null,'occurredAt',c,r);
    if(when!==null&&timestamp(source.exportedAt)&&when>timestamp(source.exportedAt).instant)issue('FUTURE_SETTLEMENT_UNSUPPORTED',c,r);
    if(row.status==='SUCCEEDED'&&!digestValid(row.evidenceDigest))issue('SETTLEMENT_EVIDENCE_DIGEST_REQUIRED',c,r);
    if(row.status==='FAILED'&&row.evidenceDigest!==null&&!digestValid(row.evidenceDigest))issue('EVIDENCE_DIGEST_INVALID',c,r);
    if(digestValid(row.evidenceDigest)){if(evidence.has(row.evidenceDigest))issue('DUPLICATE_SETTLEMENT_EVIDENCE',c,r);evidence.add(row.evidenceDigest);}
    if(row.kind==='PAYMENT'&&row.parent!==null)issue('PAYMENT_PARENT_UNEXPECTED',c,r);
    if(row.kind==='REFUND'){
      const parent=reference(row.parent,'historicalPayments','parent',c,r);
      if(parent){if(parent.kind!=='PAYMENT'||parent.status!=='SUCCEEDED'||parent.currency!==row.currency||parent.provider!==row.provider||!refValid(parent.booking)||!refValid(row.booking)||refKey(parent.booking)!==refKey(row.booking))issue('REFUND_PARENT_MISMATCH',c,r);
        const prior=timestamp(parent.occurredAt);if(when!==null&&prior&&when<prior.instant)issue('REFUND_PRECEDES_PAYMENT',c,r);}
    }
    if(booking&&refValid(row.booking)&&exactMoney(row.amount)!==null&&row.status==='SUCCEEDED'){
      const key=refKey(row.booking),bucket=ledgers.get(key)??{paid:0n,refunded:0n,paymentRows:0};if(row.kind==='PAYMENT'){bucket.paid+=exactMoney(row.amount);bucket.paymentRows++;}if(row.kind==='REFUND')bucket.refunded+=exactMoney(row.amount);ledgers.set(key,bucket);
    }
  }
  for(const [i,row]of rows.historicalBookings.entries())if(refValid(row.source)&&object(row.amounts)){
    const bucket=ledgers.get(refKey(row.source))??{paid:0n,refunded:0n,paymentRows:0};
    if(exactMoney(row.amounts.paid)!==null&&bucket.paid!==exactMoney(row.amounts.paid)||exactMoney(row.amounts.refunded)!==null&&bucket.refunded!==exactMoney(row.amounts.refunded))issue('HISTORICAL_LEDGER_UNBALANCED','historicalBookings',i+1);
    if(bucket.paymentRows>1)issue('MULTIPLE_OR_SHARED_RECEIPTS_UNSUPPORTED','historicalBookings',i+1);
  }
  for(const [i,row]of rows.unusedEntitlements.entries()){
    const c='unusedEntitlements',r=i+1,user=reference(row.user,'identities','user',c,r),shop=reference(row.shop,'shops','shop',c,r),product=reference(row.product,'giftProducts','product',c,r);
    if(user&&user.role!=='CUSTOMER')issue('CUSTOMER_ROLE_REQUIRED',c,r);if(product)sameShop(row.shop,product.shop,c,r);
    integer(row.totalUses,1,10000,'totalUses',c,r);integer(row.remainingUses,1,10000,'remainingUses',c,r);if(row.remainingUses!==row.totalUses)issue('PART_USED_ENTITLEMENT_UNSUPPORTED',c,r);
    choose(row.sourceKind,['PURCHASE','PROMOTIONAL'],'sourceKind',c,r);choose(row.status,['ACTIVE','EXPIRED'],'status',c,r);if(!zone(row.timezone))issue('HISTORICAL_TIMEZONE_REQUIRED',c,r);
    const issued=at(row.issuedAt,row.timezone,'issuedAt',c,r),expires=at(row.expiresAt,row.timezone,'expiresAt',c,r);if(issued!==null&&expires!==null&&expires<=issued)issue('INTERVAL_INVALID',c,r);
    const exported=timestamp(source.exportedAt);
    if(issued!==null&&exported&&issued>exported.instant)issue('FUTURE_ENTITLEMENT_UNSUPPORTED',c,r);
    if(expires!==null&&exported&&(row.status==='ACTIVE'&&expires<=exported.instant||row.status==='EXPIRED'&&expires>exported.instant))issue('ENTITLEMENT_EXPIRY_STATUS_CONFLICT',c,r);
    if(row.sourceKind==='PROMOTIONAL'&&row.funding!==null)issue('PROMOTIONAL_FUNDING_UNEXPECTED',c,r);
    if(row.sourceKind==='PURCHASE'&&shape(row.funding,['ownership','owner','paid','currency','evidenceDigest'],c,r)){
      choose(row.funding.ownership,['DIRECT_SHOP'],'ownership',c,r);reference(row.funding.owner,'identities','owner',c,r);
      if(shop&&refValid(shop.owner)&&refValid(row.funding.owner)&&refKey(shop.owner)!==refKey(row.funding.owner))issue('PAYMENT_OWNER_MISMATCH',c,r);
      money(row.funding.paid,'paid',c,r);curr(row.funding.currency,c,r);if(!digestValid(row.funding.evidenceDigest))issue('SETTLEMENT_EVIDENCE_DIGEST_REQUIRED',c,r);
      else {if(evidence.has(row.funding.evidenceDigest))issue('DUPLICATE_SETTLEMENT_EVIDENCE',c,r);evidence.add(row.funding.evidenceDigest);}
    }
  }
  const report={schemaVersion:2,tool:STAGING_VERSION,mode:'offline-staging-plan',stagingEligible:blockers===0,liveImportImplemented:false,deploymentReady:false,
    counts:Object.fromEntries(STAGING_COLLECTIONS.map(c=>[c,Array.isArray(input[c])?input[c].length:0])),summary:{blockers,issuesReturned:issues.length,issuesTruncated:blockers>issues.length},issueCounts,issues,
    assurance:'Selected-domain redacted preservation only. Source completeness, redaction truth and external settlement evidence are declarations, not verified facts. No live identities, reservations, balances or usable rights are imported.'};
  if(blockers)return {report,plan:null};
  const entities=[];
  const resolveShop=(c,row)=>c==='shops'?row.source:c==='variants'?maps.services.get(refKey(row.service)).shop:c==='qualifications'?maps.therapists.get(refKey(row.therapist)).shop:row.shop??null;
  for(const c of STAGING_COLLECTIONS)for(const row of rows[c]){
    const shop=resolveShop(c,row);entities.push({id:sourceMappingId(source.system,row.source),sourceSystem:source.system,sourceTable:row.source.table,sourceId:row.source.id,kind:c,
      shopKey:shop?sourceMappingId(source.system,shop):null,payload:row,payloadDigest:stagingHash(row)});
  }
  entities.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const canonicalPackage={schemaVersion:input.schemaVersion,format:input.format,source,...Object.fromEntries(STAGING_COLLECTIONS.map(c=>[c,[...rows[c]].sort((a,b)=>refKey(a.source)<refKey(b.source)?-1:1)]))};
  const packageDigest=stagingHash(canonicalPackage),reconciliation=stagingReconciliation(entities);
  const plan={version:STAGING_VERSION,packageDigest,sourceSystem:source.system,datasetKind:source.datasetKind,entities,reconciliation};
  plan.planDigest=stagingHash({version:plan.version,packageDigest,sourceSystem:plan.sourceSystem,datasetKind:plan.datasetKind,rows:entities.map(e=>({id:e.id,kind:e.kind,shopKey:e.shopKey,payloadDigest:e.payloadDigest})),reconciliation});
  return {report:{...report,packageDigest,planDigest:plan.planDigest,reconciliation},plan};
}

export function stagingReconciliation(entities) {
  const counts=Object.fromEntries(STAGING_COLLECTIONS.map(c=>[c,0])),buckets=new Map();
  for(const entity of entities){
    counts[entity.kind]++;if(!entity.shopKey)continue;
    const row=entity.payload;
    const currencies=['historicalBookings','historicalPayments','services','variants','giftProducts'].includes(entity.kind)?[row.currency]:entity.kind==='unusedEntitlements'?[row.funding?.currency??'none']:['none'];
    const key=canonicalJson([entity.shopKey,currencies[0]]),bucket=buckets.get(key)??{shopKey:entity.shopKey,currency:currencies[0],counts:Object.fromEntries(STAGING_COLLECTIONS.map(c=>[c,0])),catalogPriceCents:0n,historicalBaseCents:0n,historicalDiscountCents:0n,historicalFeeCents:0n,historicalTipCents:0n,historicalTaxCents:0n,historicalTotalCents:0n,historicalPaidCents:0n,historicalRefundedCents:0n,paymentCents:0n,refundCents:0n,unusedUses:0n,entitlementFundingCents:0n};
    bucket.counts[entity.kind]++;
    if(['services','variants','giftProducts'].includes(entity.kind))bucket.catalogPriceCents+=BigInt(row.price.cents);
    if(entity.kind==='historicalBookings'){for(const name of ['base','discount','fee','tip','tax','total','paid','refunded'])bucket[`historical${name[0].toUpperCase()+name.slice(1)}Cents`]+=BigInt(row.amounts[name].cents);}
    if(entity.kind==='historicalPayments'&&row.status==='SUCCEEDED'){if(row.kind==='PAYMENT')bucket.paymentCents+=BigInt(row.amount.cents);else bucket.refundCents+=BigInt(row.amount.cents);}
    if(entity.kind==='unusedEntitlements'){bucket.unusedUses+=BigInt(row.remainingUses);if(row.funding)bucket.entitlementFundingCents+=BigInt(row.funding.paid.cents);}
    buckets.set(key,bucket);
  }
  return {counts,byShopCurrency:[...buckets.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,row])=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?value.toString():value])))};
}
