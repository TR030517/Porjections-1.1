import { apiRequest, ApiError } from "./session";

export type GiftEntitlementStatus =
  | "ACTIVE"
  | "EXHAUSTED"
  | "EXPIRED"
  | "VOIDED";
export type GiftEntitlementSource = "PROMOTIONAL" | "PURCHASE" | "PURCHASED" | "LEGACY";
export interface GiftCardConfig {
  salesEnabled: boolean;
  onlinePaymentEnabled: boolean;
  paymentMethods: string[];
  currency: string;
  reason: string;
  promotionalEntitlementsEnabled: boolean;
  credentialTtlSeconds: number;
}
export interface GiftProduct {
  id: string;
  shopId: string;
  title: string;
  description?: string | null;
  priceCents: number;
  currency: string;
  useTimes: number;
  expireDays: number;
  status: string;
  salesEnabled: boolean;
  paymentMethods: string[];
}
export interface GiftEntitlement {
  id: string;
  userId: string;
  shopId: string;
  productId: string;
  orderId: string | null;
  productTitleSnapshot: string | null;
  source: GiftEntitlementSource;
  totalUses: number;
  remainingUses: number;
  expiresAt: string;
  timezone: string | null;
  expiresAtLocal: string | null;
  status: GiftEntitlementStatus;
  grantReasonRecorded: boolean;
  voidReasonRecorded: boolean;
  grantedById: string | null;
  voidedAt: string | null;
  createdAt: string;
  createdAtLocal: string | null;
}
export interface GiftRedemption {
  id: string;
  entitlementId: string;
  shopId: string | null;
  operatorId: string;
  usedUses: number;
  createdAt: string;
  timezone: string | null;
  createdAtLocal: string | null;
}
export interface GiftPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  shopId?: string;
}
export interface GiftListQuery {
  page: number;
  pageSize: number;
  userId?: string;
  entitlementId?: string;
  status?: GiftEntitlementStatus | "";
}
export interface GrantGiftPayload {
  productId: string;
  userId: string;
  reason: string;
  requestKey: string;
}
export interface RedeemGiftPayload {
  token: string;
  usedUses: number;
  requestKey: string;
}
export interface GiftRedemptionResult {
  item: GiftRedemption;
  replayed: boolean;
  remainingUses?: number;
}

const idPattern = /^[1-9]\d{0,18}$/;
function shopPath(shopId: string) {
  if (!idPattern.test(shopId)) throw new ApiError("请先选择有效门店。");
  return "/gift-cards/admin/shops/" + encodeURIComponent(shopId);
}
function params(query: object) {
  const search = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  return search.toString();
}
function checkPage<T>(value: GiftPage<T>, belongs: (item: T) => boolean) {
  if (
    !value ||
    !Array.isArray(value.items) ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    !Number.isSafeInteger(value.page) ||
    value.page < 1 ||
    !Number.isSafeInteger(value.pageSize) ||
    value.pageSize < 1 ||
    !Number.isSafeInteger(value.totalPages) ||
    value.totalPages < 0 ||
    !value.items.every(belongs)
  ) {
    throw new ApiError("服务返回的礼品权益列表无效，请刷新核对。");
  }
  return value;
}
function isEntitlement(item: GiftEntitlement, shopId: string) {
  return (
    item != null &&
    typeof item.id === "string" &&
    item.shopId === shopId &&
    typeof item.userId === "string" &&
    typeof item.productId === "string" &&
    ["ACTIVE", "EXHAUSTED", "EXPIRED", "VOIDED"].includes(item.status) &&
    ["PROMOTIONAL", "PURCHASE", "PURCHASED", "LEGACY"].includes(item.source) &&
    Number.isSafeInteger(item.totalUses) &&
    item.totalUses > 0 &&
    Number.isSafeInteger(item.remainingUses) &&
    item.remainingUses >= 0 &&
    item.remainingUses <= item.totalUses
  );
}
function isRedemption(
  item: GiftRedemption,
  shopId: string,
  allowLegacySnapshot = false,
) {
  return (
    item != null &&
    typeof item.id === "string" &&
    typeof item.entitlementId === "string" &&
    (item.shopId === shopId || (allowLegacySnapshot && item.shopId === null)) &&
    Number.isSafeInteger(item.usedUses) &&
    item.usedUses > 0
  );
}
export async function getGiftCardConfig(signal?: AbortSignal) {
  const result = await apiRequest<GiftCardConfig>("/gift-cards/config", {
    signal,
    cache: "no-store",
  });
  if (
    !result ||
    typeof result.salesEnabled !== "boolean" ||
    typeof result.promotionalEntitlementsEnabled !== "boolean" ||
    typeof result.reason !== "string" ||
    !Number.isFinite(result.credentialTtlSeconds)
  )
    throw new ApiError("礼品卡功能状态暂不可用。");
  return result;
}
// This endpoint returns active products from published shops only, with server pagination.
export async function listGiftProducts(
  shopId: string,
  page = 1,
  signal?: AbortSignal,
) {
  shopPath(shopId);
  const result = await apiRequest<GiftPage<GiftProduct>>(
    "/gift-cards/products?" + params({ shopId, page, pageSize: 20 }),
    { signal, cache: "no-store" },
  );
  return checkPage(
    result,
    (item) =>
      item?.shopId === shopId &&
      typeof item.id === "string" &&
      item.status === "ACTIVE",
  );
}
export async function listGiftEntitlements(
  shopId: string,
  query: GiftListQuery,
  signal?: AbortSignal,
) {
  const result = await apiRequest<GiftPage<GiftEntitlement>>(
    shopPath(shopId) + "/entitlements?" + params(query),
    { signal, cache: "no-store" },
  );
  if (result?.shopId !== shopId)
    throw new ApiError("权益门店不匹配，请重新加载。");
  return checkPage(result, (item) => isEntitlement(item, shopId));
}
export async function listGiftRedemptions(
  shopId: string,
  query: Omit<GiftListQuery, "status">,
  signal?: AbortSignal,
) {
  const result = await apiRequest<GiftPage<GiftRedemption>>(
    shopPath(shopId) + "/redemptions?" + params(query),
    { signal, cache: "no-store" },
  );
  if (result?.shopId !== shopId)
    throw new ApiError("核销记录门店不匹配，请重新加载。");
  // Legacy records may lack a shop snapshot; this endpoint authorizes via their entitlement's shop.
  return checkPage(result, (item) => isRedemption(item, shopId, true));
}
export async function grantGiftEntitlement(
  shopId: string,
  payload: GrantGiftPayload,
  signal?: AbortSignal,
) {
  const result = await apiRequest<{
    item: GiftEntitlement;
    promotional: boolean;
    saleRecorded: boolean;
  }>(shopPath(shopId) + "/grants", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
  if (
    !isEntitlement(result?.item, shopId) ||
    result.item.userId !== payload.userId ||
    result.item.productId !== payload.productId ||
    result.item.source !== "PROMOTIONAL" ||
    result.item.orderId !== null ||
    result.promotional !== true ||
    result.saleRecorded !== false
  ) {
    throw new ApiError(
      "未收到可确认的赠送结果，请保持表单不变重试或刷新核对。",
    );
  }
  return result.item;
}
export async function voidGiftEntitlement(
  shopId: string,
  entitlementId: string,
  reason: string,
  signal?: AbortSignal,
) {
  const result = await apiRequest<{ item: GiftEntitlement }>(
    shopPath(shopId) +
      "/entitlements/" +
      encodeURIComponent(entitlementId) +
      "/void",
    {
      method: "POST",
      body: JSON.stringify({ reason }),
      signal,
    },
  );
  if (
    !isEntitlement(result?.item, shopId) ||
    result.item.id !== entitlementId ||
    result.item.status !== "VOIDED"
  ) {
    throw new ApiError(
      "未收到可确认的作废结果，请保持原因不变重试或刷新核对。",
    );
  }
  return result.item;
}
export async function redeemGiftCredential(
  shopId: string,
  payload: RedeemGiftPayload,
  signal?: AbortSignal,
) {
  const result = await apiRequest<GiftRedemptionResult>(
    shopPath(shopId) + "/redeem",
    { method: "POST", body: JSON.stringify(payload), signal },
  );
  if (
    !isRedemption(result?.item, shopId) ||
    result.item.usedUses !== payload.usedUses ||
    typeof result.replayed !== "boolean" ||
    (result.remainingUses !== undefined &&
      (!Number.isSafeInteger(result.remainingUses) || result.remainingUses < 0))
  ) {
    throw new ApiError(
      "未收到可确认的核销结果，请保持凭证和次数不变重试或查询记录。",
    );
  }
  return result;
}
// The random key contains no customer ID, reason or redemption credential.
export function newGiftRequestKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export type GiftOrderStatus = "PENDING" | "PAID" | "CANCELLED" | "REFUNDED";
export type GiftSaleMethod = "CASH" | "EXTERNAL_CARD" | "OTHER";
export interface GiftSaleEvidence {
  id: string; amountCents: number; method: GiftSaleMethod; reference: string | null;
  reason: string; createdAt: string; createdAtLocal: string | null; operatorId: string;
}
export interface GiftOrder {
  id: string; orderNo: string; userId: string; shopId: string; productId: string;
  productTitleSnapshot: string | null; useTimesSnapshot: number | null; expireDaysSnapshot: number | null;
  amountCents: number; paidCents: number; refundedCents: number; currency: string;
  status: GiftOrderStatus; paymentMethod: string; entitlementId: string | null;
  createdAt: string; timezone: string | null; createdAtLocal: string | null; receipts: GiftSaleEvidence[]; refunds: GiftSaleEvidence[];
  allowedActions: { cancel: boolean; recordReceipt: boolean; recordRefund: boolean };
}
export interface GiftSalesPolicy { shopId: string; payAtStoreEnabled: boolean; onlinePaymentEnabled: false; paymentMethods: string[] }
export interface GiftSalePayload { amountCents: number; method: GiftSaleMethod; reference?: string; reason: string; requestKey: string }
function validOrder(row: GiftOrder, shopId: string) {
  return !!row && typeof row.id === "string" && row.shopId === shopId &&
    typeof row.userId === "string" && typeof row.currency === "string" &&
    ["PENDING","PAID","CANCELLED","REFUNDED"].includes(row.status) &&
    [row.amountCents,row.paidCents,row.refundedCents].every(value => Number.isSafeInteger(value) && value >= 0) &&
    row.refundedCents <= row.paidCents && row.paidCents <= row.amountCents &&
    row.allowedActions != null && [row.allowedActions.cancel,row.allowedActions.recordReceipt,row.allowedActions.recordRefund].every(value => typeof value === "boolean");
}
function checkedOrder(row: GiftOrder, shopId: string, id?: string) {
  if (!validOrder(row,shopId) || (id && row.id !== id)) throw new ApiError("礼品订单结果无法核对，请刷新后再处理。");
  return row;
}
export async function getGiftSalesPolicy(shopId: string, signal?: AbortSignal) {
  const row = await apiRequest<GiftSalesPolicy>(shopPath(shopId) + "/sales-policy", {signal,cache:"no-store"});
  if (row?.shopId !== shopId || typeof row.payAtStoreEnabled !== "boolean" || row.onlinePaymentEnabled !== false) throw new ApiError("门店礼品销售政策无法确认。");
  return row;
}
export async function setGiftSalesPolicy(shopId: string, enabled: boolean, signal?: AbortSignal) {
  const row = await apiRequest<GiftSalesPolicy>(shopPath(shopId) + "/sales-policy", {method:"POST",body:JSON.stringify({payAtStoreEnabled:enabled}),signal});
  if (row?.shopId !== shopId || row.payAtStoreEnabled !== enabled || row.onlinePaymentEnabled !== false) throw new ApiError("销售政策保存结果无法确认，请重载核对。");
  return row;
}
export async function listGiftOrders(shopId: string, query: {page:number;pageSize:number;status?:GiftOrderStatus|"";userId?:string}, signal?:AbortSignal) {
  const result = await apiRequest<GiftPage<GiftOrder>>(shopPath(shopId)+"/orders?"+params(query),{signal,cache:"no-store"});
  return checkPage(result,row=>validOrder(row,shopId));
}
export async function getGiftOrder(shopId: string,id:string,signal?:AbortSignal) {
  const value = await apiRequest<{item:GiftOrder}>(shopPath(shopId)+"/orders/"+encodeURIComponent(id),{signal,cache:"no-store"});
  return checkedOrder(value?.item,shopId,id);
}
export async function recordGiftSale(shopId:string,id:string,kind:"receipts"|"refunds",payload:GiftSalePayload,signal?:AbortSignal) {
  const value=await apiRequest<{item:GiftOrder}>(shopPath(shopId)+"/orders/"+encodeURIComponent(id)+"/"+kind,{method:"POST",body:JSON.stringify(payload),signal});
  const row=checkedOrder(value?.item,shopId,id);
  if ((kind==="receipts" && (row.status!=="PAID" || row.paidCents!==payload.amountCents || !row.entitlementId)) ||
      (kind==="refunds" && (row.status!=="REFUNDED" || row.refundedCents!==payload.amountCents))) throw new ApiError("收退款登记结果无法确认。保持内容不变重试或查看凭证。");
  return row;
}
