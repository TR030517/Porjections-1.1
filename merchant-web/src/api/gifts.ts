import client from './client';

export interface GiftConfig { salesEnabled: boolean; onlinePaymentEnabled: boolean; paymentMethods: string[]; currency: string; reason: string; promotionalEntitlementsEnabled: boolean; credentialTtlSeconds: number; }
export interface GiftProduct { id: string; shopId: string; title: string; description: string | null; priceCents: number; currency: string; useTimes: number; expireDays: number; status: string; salesEnabled: boolean; }
export interface Entitlement { id: string; userId: string; shopId: string; productId: string; orderId: string | null; productTitleSnapshot: string; source: 'PROMOTIONAL' | 'PURCHASE' | 'PURCHASED' | 'LEGACY'; totalUses: number; remainingUses: number; expiresAt: string | null; timezone: string | null; expiresAtLocal: string | null; status: string; grantReasonRecorded: boolean; voidReasonRecorded: boolean; grantedById: string | null; voidedAt: string | null; createdAt: string; }
export interface Redemption { id: string; entitlementId: string; shopId: string; operatorId: string; usedUses: number; createdAt: string; timezone: string | null; createdAtLocal: string | null; }
export interface GiftPage<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number; }
const base = (shopId: string) => `/gift-cards/admin/shops/${encodeURIComponent(shopId)}`;
function assertPage<T extends { shopId: string }>(data: GiftPage<T>, shopId: string): GiftPage<T> {
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.items.some(row => String(row.shopId) !== shopId)) throw new Error('礼品卡响应与当前门店不符。');
  return data;
}
export async function getGiftConfig(signal?: AbortSignal): Promise<GiftConfig> { const { data } = await client.get('/gift-cards/config', { signal }); return data; }
export async function getGiftProducts(shopId: string, page: number, signal?: AbortSignal): Promise<GiftPage<GiftProduct>> {
  const { data } = await client.get('/gift-cards/products', { params: { shopId, page, pageSize: 25 }, signal }); return assertPage(data, shopId);
}
export async function getEntitlements(shopId: string, filters: { page: number; pageSize: number; userId?: string; status?: string; entitlementId?: string }, signal?: AbortSignal): Promise<GiftPage<Entitlement>> {
  const { data } = await client.get(base(shopId) + '/entitlements', { params: filters, signal }); return assertPage(data, shopId);
}
export async function getRedemptions(shopId: string, filters: { page: number; pageSize: number; userId?: string; entitlementId?: string }, signal?: AbortSignal): Promise<GiftPage<Redemption>> {
  const { data } = await client.get(base(shopId) + '/redemptions', { params: filters, signal }); return assertPage(data, shopId);
}
export async function grantGift(shopId: string, payload: { productId: string; userId: string; reason: string; requestKey: string }): Promise<Entitlement> {
  const { data } = await client.post(base(shopId) + '/grants', payload);
  if (!data?.item?.id || String(data.item.shopId) !== shopId || data.promotional !== true || data.saleRecorded !== false) throw new Error('赠送结果尚未确认，请刷新后使用原请求重试。');
  return data.item;
}
export async function redeemGift(shopId: string, payload: { token: string; usedUses: number; requestKey: string }): Promise<{ item: Redemption; replayed: boolean; remainingUses?: number }> {
  const { data } = await client.post(base(shopId) + '/redeem', payload);
  if (!data?.item?.id || String(data.item.shopId) !== shopId) throw new Error('核销结果尚未确认，请检查记录后使用原请求重试。');
  return data;
}
export async function voidGift(shopId: string, id: string, reason: string): Promise<Entitlement> {
  const { data } = await client.post(base(shopId) + '/entitlements/' + encodeURIComponent(id) + '/void', { reason });
  if (String(data?.item?.id) !== id || String(data.item.shopId) !== shopId) throw new Error('作废结果尚未确认，请刷新权益记录。');
  return data.item;
}

export type GiftSaleMethod = 'CASH' | 'EXTERNAL_CARD' | 'OTHER';
export interface GiftSaleEvidence { id: string; amountCents: number; method: GiftSaleMethod; reference: string | null; reason: string; createdAt: string; createdAtLocal: string | null; operatorId: string; }
export interface GiftOrder { id: string; orderNo: string; userId: string; shopId: string; productId: string; productTitleSnapshot: string | null; useTimesSnapshot: number | null; expireDaysSnapshot: number | null; amountCents: number; paidCents: number; refundedCents: number; currency: string; status: string; paymentMethod: string; entitlementId: string | null; createdAt: string; timezone: string | null; createdAtLocal: string | null; receipts: GiftSaleEvidence[]; refunds: GiftSaleEvidence[]; allowedActions: { cancel: boolean; recordReceipt: boolean; recordRefund: boolean }; }
export interface GiftSalesPolicy { shopId: string; payAtStoreEnabled: boolean; onlinePaymentEnabled: false; paymentMethods: string[]; }
export interface GiftSalePayload { amountCents: number; method: GiftSaleMethod; reference?: string; reason: string; requestKey: string; }
function validOrder(row: GiftOrder, shopId: string) {
  return !!row && typeof row.id === 'string' && row.shopId === shopId && typeof row.userId === 'string' && typeof row.currency === 'string' && ['PENDING','PAID','CANCELLED','REFUNDED'].includes(row.status) && [row.amountCents,row.paidCents,row.refundedCents].every(value => Number.isSafeInteger(value) && value >= 0) && row.refundedCents <= row.paidCents && row.paidCents <= row.amountCents && row.allowedActions != null && [row.allowedActions.cancel,row.allowedActions.recordReceipt,row.allowedActions.recordRefund].every(value => typeof value === 'boolean');
}
function orderResult(row: GiftOrder,shopId: string,id: string) { if (!validOrder(row,shopId) || row.id!==id) throw new Error('无法核对礼品订单结果，请刷新后再尝试。'); return row; }
export async function getGiftSalesPolicy(shopId:string,signal?:AbortSignal):Promise<GiftSalesPolicy> {
  const {data}=await client.get(base(shopId)+'/sales-policy',{signal});
  if(data?.shopId!==shopId||typeof data.payAtStoreEnabled!=='boolean'||data.onlinePaymentEnabled!==false)throw new Error('无法核对门店礼品销售规则。');return data;
}
export async function saveGiftSalesPolicy(shopId:string,enabled:boolean,signal?:AbortSignal):Promise<GiftSalesPolicy> {
  const {data}=await client.post(base(shopId)+'/sales-policy',{payAtStoreEnabled:enabled},{signal});
  if(data?.shopId!==shopId||data.payAtStoreEnabled!==enabled||data.onlinePaymentEnabled!==false)throw new Error('无法核对销售规则结果，请刷新核对。');return data;
}
export async function getGiftOrders(shopId:string,filters:{page:number;pageSize:number;status?:string;userId?:string},signal?:AbortSignal):Promise<GiftPage<GiftOrder>> {
  const {data}=await client.get(base(shopId)+'/orders',{params:filters,signal});const page=assertPage<GiftOrder>(data,shopId);
  if(!page.items.every(row=>validOrder(row,shopId)))throw new Error('无法核对礼品订单列表。');return page;
}
export async function getGiftOrder(shopId:string,id:string,signal?:AbortSignal):Promise<GiftOrder> {
  const {data}=await client.get(base(shopId)+'/orders/'+encodeURIComponent(id),{signal});return orderResult(data?.item,shopId,id);
}
export async function recordGiftSale(shopId:string,id:string,kind:'receipts'|'refunds',payload:GiftSalePayload,signal?:AbortSignal):Promise<GiftOrder> {
  const {data}=await client.post(base(shopId)+'/orders/'+encodeURIComponent(id)+'/'+kind,payload,{signal});const row=orderResult(data?.item,shopId,id);
  if((kind==='receipts'&&(row.status!=='PAID'||row.paidCents!==payload.amountCents||!row.entitlementId))||(kind==='refunds'&&(row.status!=='REFUNDED'||row.refundedCents!==payload.amountCents)))throw new Error('收退款结果尚未确认，请使用不变的原请求重试或核对凭证。');return row;
}
