export interface BookingSettlementGuidance { title: string; message: string; }
const statuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'];
const modes = ['ONLINE', 'PAY_AT_STORE', 'ZERO'];
const payments = ['UNPAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const cents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** A live policy flag never erases receipts, refunds, ZERO/ONLINE history or
 * unknown financial evidence. Keep the full ledger whenever facts are unclear. */
export function isSimpleOfflineOrder(value: unknown): boolean {
  if (!record(value) || value.orderOnly !== true || value.onlinePaymentEnabled === true || value.paymentMode !== 'PAY_AT_STORE'
    || value.paymentStatus !== 'UNPAID' || !['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(String(value.status))
    || !cents(value.totalCents) || value.paidCents !== 0 || value.refundedCents !== 0 || value.netPaidCents !== 0
    || !Array.isArray(value.entries) || value.entries.length !== 0
    || value.platformFeeCents !== undefined && value.platformFeeCents !== 0 || value.tipCents !== undefined && value.tipCents !== 0) return false;
  return value.amountDueCents === (value.status === 'CANCELLED' ? 0 : value.totalCents);
}

/** Explain only the authoritative settlement snapshot. Never enables an action, changes money or infers why an action was denied. */
export function bookingSettlementGuidance(value: unknown, {
  canManageBooking = true,
  canRecordSettlement = true,
}: { canManageBooking?: boolean; canRecordSettlement?: boolean } = {}): BookingSettlementGuidance {
  const unknown = { title: '结算状态待核对', message: '暂时无法核对当前预约与结算记录，请刷新详情与账本后再处理。' };
  if (!record(value) || !statuses.includes(String(value.status)) || !modes.includes(String(value.paymentMode)) || !payments.includes(String(value.paymentStatus))) return unknown;
  const { status, paymentMode, paymentStatus, totalCents, paidCents, refundedCents, netPaidCents, amountDueCents } = value;
  const validMoney = cents(totalCents) && cents(paidCents) && cents(refundedCents) && cents(netPaidCents) && cents(amountDueCents)
    && refundedCents <= paidCents && netPaidCents === paidCents - refundedCents;
  const titles: Record<string, string> = { PENDING: paymentMode === 'PAY_AT_STORE' ? '预约待接受' : '预约待确认', CONFIRMED: '预约已确认', COMPLETED: '服务已完成', CANCELLED: '预约已取消', REFUNDING: '退款处理状态', REFUNDED: '预约标记已退款' };
  const state: Record<string, string> = {
    PENDING: canManageBooking ? '预约仍待确认，能否接受及有效期以当前服务端状态和操作按钮为准。' : '预约仍待确认，当前状态及有效期以服务器记录为准。',
    CONFIRMED: '预约已确认，履约状态与收款记录分别保留。',
    COMPLETED: '服务已完成，完成服务不代表已经收齐款项。',
    CANCELLED: '此处保留已取消预约的历史账目。取消预约不会自动退款。',
    REFUNDING: '预约处于退款处理状态，请核对售后与渠道记录；当前状态不代表款项已退还或到账。',
    REFUNDED: '预约标记为已退款，已退金额、净实收和渠道实际结果仍需分别核对。',
  };
  const title = titles[String(status)], prefix = state[String(status)];
  if (!validMoney) return { title, message: prefix + '金额记录暂无法核对，请刷新账本；不要据此重复登记。' };
  if (isSimpleOfflineOrder(value)) {
    const orderTitles: Record<string, string> = { PENDING: '订单待确认', CONFIRMED: '预约已确认', COMPLETED: '服务已完成', CANCELLED: '订单已取消' };
    const fulfilment: Record<string, string> = { PENDING: '订单已记录，等待门店确认预约。', CONFIRMED: '预约已确认，请按约提供服务。',
      COMPLETED: '服务履约已完成；此状态不代表已经收款。', CANCELLED: '订单已取消，保留原订单资料供核对。' };
    return { title: orderTitles[String(status)], message: fulfilment[String(status)] + '款项由门店与顾客线下处理，系统不发起在线扣款。'
      + (status !== 'CANCELLED' && canManageBooking ? '确认或完成服务不要求先登记收款。' : '')
      + (status !== 'CANCELLED' && canRecordSettlement ? '如需留存实际收退记录，可使用可选账本。' : '') };
  }
  if (paymentMode === 'ZERO') {
    const zero = totalCents === 0 && paidCents === 0 && refundedCents === 0 && netPaidCents === 0 && amountDueCents === 0 && paymentStatus === 'PAID';
    return { title: zero ? title : '零金额记录待核对', message: prefix + (zero ? '这是服务端零金额结算记录，不产生外部付款或可退款资金。' : '零金额模式与金额或付款状态不一致，请刷新核对。') };
  }
  const inactive = ['CANCELLED', 'REFUNDING', 'REFUNDED'].includes(String(status));
  const facts = inactive ? netPaidCents! > 0 ? '账本仍有净实收记录，请核对结算流水与售后处理。' : '账本当前净实收为零；这不能单独证明渠道退款已到账。'
    : amountDueCents! > 0 ? '账本仍有待收余额。' + (canRecordSettlement ? '能否登记以当前服务端允许的操作为准。' : '')
      : refundedCents! > 0 ? '账本含退款记录，请分别核对已收、已退和净实收。' : '账本当前待收余额为零，实际收款情况以已保存流水为准。';
  if (paymentMode === 'ONLINE') {
    const cancellation = canManageBooking && ['PENDING', 'CONFIRMED'].includes(String(status)) && netPaidCents! > 0 ? '如需取消已付款预约，请先核对售后与渠道退款处理。' : '';
    return { title, message: prefix + facts + '在线款项以渠道和服务端账本为准，不能混记线下收款。' + cancellation };
  }
  const pending = status === 'PENDING' ? '接受预约不代表已经收到款项。' : '';
  const policy = inactive ? '结算流水继续保留供核对。' : '登记仅记录已实际发生的收款或退款，不会发送银行转账或自动退款。';
  return { title, message: prefix + pending + facts + policy };
}
