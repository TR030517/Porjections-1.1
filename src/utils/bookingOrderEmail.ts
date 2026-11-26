export type BookingOrderEmailState = 'QUEUED' | 'PROCESSING' | 'ACCEPTED' | 'NOT_CONFIGURED' | 'FAILED' | 'ACCEPTANCE_UNKNOWN' | 'CANCELLED' | 'NOT_REQUESTED';
export type BookingOrderEmailAudience = 'CUSTOMER' | 'SHOP';
const reasonCodes = ['ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE', 'ORDER_EMAIL_STORE_RECIPIENT_CHANGED', 'ORDER_EMAIL_STORE_UNAVAILABLE',
  'ORDER_EMAIL_RECIPIENT_UNAVAILABLE', 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE', 'ORDER_EMAIL_NOT_CONFIGURED', 'ORDER_EMAIL_RATE_LIMITED',
  'ORDER_EMAIL_PROVIDER_REJECTED', 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN', 'ORDER_EMAIL_EVENT_OBSOLETE',
  'ORDER_EMAIL_GUEST_NO_ADDRESS', 'ORDER_EMAIL_GUEST_AUTHORIZATION_REQUIRED'] as const;
export type BookingOrderEmailReasonCode = typeof reasonCodes[number];
export interface BookingOrderEmailView { bookingId: string; status: BookingOrderEmailState; statusReasonCode?: BookingOrderEmailReasonCode;
  storeStatus?: BookingOrderEmailState; storeStatusReasonCode?: BookingOrderEmailReasonCode; workerEnabled: boolean; localCapture?: boolean; }
const states: BookingOrderEmailState[] = ['QUEUED', 'PROCESSING', 'ACCEPTED', 'NOT_CONFIGURED', 'FAILED', 'ACCEPTANCE_UNKNOWN', 'CANCELLED', 'NOT_REQUESTED'];
function readReasonCode(value: unknown, audience: BookingOrderEmailAudience): BookingOrderEmailReasonCode | undefined {
  if (typeof value !== 'string' || !(reasonCodes as readonly string[]).includes(value)
    || audience === 'CUSTOMER' && value.startsWith('ORDER_EMAIL_STORE_')
    || audience === 'SHOP' && (value === 'ORDER_EMAIL_RECIPIENT_UNAVAILABLE' || value.startsWith('ORDER_EMAIL_GUEST_'))) return undefined;
  return value as BookingOrderEmailReasonCode;
}
export function orderEmailPath(bookingId: string): string {
  if (!/^[1-9]\d{0,18}$/.test(bookingId) || BigInt(bookingId) > 9223372036854775807n) throw Error('订单编号无法核对');
  return '/notifications/bookings/' + encodeURIComponent(bookingId) + '/order-email';
}
/** Display a whitelist only. No recipient, provider ID, payload or account data
 * from the transport is copied into component state or shown to an operator. */
export function readBookingOrderEmail(raw: unknown, bookingId: string): BookingOrderEmailView {
  orderEmailPath(bookingId);
  const value = raw as Record<string, any>;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.bookingId !== bookingId || value.channel !== 'EMAIL'
    || !states.includes(value.status) || !value.configuration || typeof value.configuration.enabled !== 'boolean'
    || value.configuration.acceptanceIsDelivery !== false || typeof value.configuration.workerEnabled !== 'boolean'
    || ![null, 'resend', 'local'].includes(value.configuration.provider)
    || value.configuration.provider === 'local' && value.configuration.deliveryMode !== 'LOCAL_CAPTURE'
    || !Array.isArray(value.tasks)
    || (value.storeStatus !== undefined || value.storeTasks !== undefined)
      && (!states.includes(value.storeStatus) || !Array.isArray(value.storeTasks))) throw Error('订单邮件状态无法核对');
  const statusReasonCode = readReasonCode(value.statusReasonCode, 'CUSTOMER');
  const storeStatusReasonCode = value.storeStatus === undefined ? undefined : readReasonCode(value.storeStatusReasonCode, 'SHOP');
  return { bookingId, status: value.status, workerEnabled: value.configuration.workerEnabled,
    ...(statusReasonCode ? { statusReasonCode } : {}),
    ...(value.storeStatus !== undefined ? { storeStatus: value.storeStatus } : {}),
    ...(storeStatusReasonCode ? { storeStatusReasonCode } : {}),
    ...(value.configuration.provider === 'local' ? { localCapture: true } : {}) };
}
/** Reasons describe the current task only; never infer them from an old task,
 * a recipient address, or a raw provider response. */
export function bookingOrderEmailReasonMessage(reason: unknown, status?: BookingOrderEmailState,
  audience: BookingOrderEmailAudience = 'CUSTOMER', localCapture = false): string | undefined {
  const code = readReasonCode(reason, audience);
  if (code === 'ORDER_EMAIL_GUEST_NO_ADDRESS') return status === 'NOT_REQUESTED' ? '此首次客预约未填写邮箱，没有请求顾客邮件；订单已保存，门店通知独立处理。' : undefined;
  if (code === 'ORDER_EMAIL_GUEST_AUTHORIZATION_REQUIRED') return status === 'NOT_REQUESTED' ? '此首次客邮箱仅为联系人记录，尚未验证收件授权，不发送顾客邮件；不会据此关联顾客账号。' : undefined;
  if (!code || !status || status === 'ACCEPTED' || status === 'NOT_REQUESTED') return undefined;
  const recipient = audience === 'SHOP' ? '门店' : '客人';
  let message: string;
  switch (code) {
    case 'ORDER_EMAIL_STORE_RECIPIENT_UNAVAILABLE':
      message = '本任务无法使用原门店收件邮箱；请核对门店邮箱并另行联系门店确认接单。补填邮箱不会自动将此历史通知改发到新地址。'; break;
    case 'ORDER_EMAIL_STORE_RECIPIENT_CHANGED':
      message = '门店收件邮箱已变更，本任务不能转发到新邮箱；请核对门店接单情况，并通过电话等方式另行通知门店。'; break;
    case 'ORDER_EMAIL_STORE_UNAVAILABLE':
      message = '原订单对应的门店已不可用；请核对门店状态并人工处理订单，不能仅靠重试邮件解决。'; break;
    case 'ORDER_EMAIL_RECIPIENT_UNAVAILABLE':
      message = '客人账户或已验证的收件邮箱不可用；请核对账户状态与邮箱验证情况，并通过其他方式联系客人。'; break;
    case 'ORDER_EMAIL_SNAPSHOT_UNAVAILABLE':
      message = `本任务缺少可核对的订单快照，无法安全生成${recipient}通知；请人工核对订单内容并另行通知，勿直接重复处理此任务。`; break;
    case 'ORDER_EMAIL_NOT_CONFIGURED':
      message = localCapture
        ? '最近一次处理时本地邮件捕获未配置；请平台核对捕获配置，并重新读取任务状态。'
        : `最近一次处理时订单邮件服务未配置；请平台完善发送配置，并另行联系${recipient}确认订单。`; break;
    case 'ORDER_EMAIL_RATE_LIMITED':
      message = '最近一次处理触发邮件服务限流；请等待并重新读取状态，勿连续重发。'; break;
    case 'ORDER_EMAIL_PROVIDER_REJECTED':
      message = `邮件处理服务拒绝了最近一次处理；请平台核对配置与任务记录，并另行联系${recipient}，勿反复提交。`; break;
    case 'ORDER_EMAIL_ACCEPTANCE_UNKNOWN':
      message = localCapture
        ? '本地捕获结果无法确认；请核对捕获记录，确认原任务结果前勿重复处理。'
        : `服务商是否受理此邮件仍无法确认；请平台核对发送记录，并向${recipient}确认通知情况，勿直接重发。`; break;
    case 'ORDER_EMAIL_EVENT_OBSOLETE':
      message = '订单已发生变化，此通知不再对应当前订单状态；请核对最新订单及其通知记录，勿重发过期通知。'; break;
  }
  return localCapture ? `${message} 当前为本地验收模式，不向${recipient}外发邮件。` : message;
}
export function bookingOrderEmailMessage(status?: BookingOrderEmailState, workerEnabled = true, localCapture = false, audience: BookingOrderEmailAudience = 'CUSTOMER') {
  const recipient = audience === 'SHOP' ? '门店' : '客人';
  if (localCapture) {
    if (status === 'ACCEPTED') return `订单邮件已保存到本地验收文件，未向${recipient}外发邮件。`;
    if (status === 'QUEUED' || status === 'PROCESSING') return workerEnabled
      ? `订单邮件等待本地捕获，仅生成验收文件，不向${recipient}外发邮件。`
      : `订单邮件等待本地捕获，但处理器未启动；未向${recipient}外发邮件。`;
    if (status === 'NOT_REQUESTED') return `此订单尚无${recipient}邮件任务；当前为本地验收模式，不向${recipient}外发邮件。`;
    if (status === 'NOT_CONFIGURED') return `本地邮件捕获尚未配置，未向${recipient}外发邮件。`;
    if (status === 'FAILED') return `本次本地邮件捕获失败，未向${recipient}外发邮件；请核对本地捕获记录。`;
    if (status === 'CANCELLED') return `此本地邮件任务已取消，不能据此判断${recipient}是否收到其他通知；本地模式不外发邮件。`;
    if (status === 'ACCEPTANCE_UNKNOWN') return `本地邮件捕获结果暂不确定，请核对捕获记录，勿据此重复处理；未向${recipient}外发邮件。`;
    return `当前为本地邮件验收模式，不向${recipient}外发邮件；邮件状态暂无法核对，请重新读取。`;
  }
  if ((status === 'QUEUED' || status === 'PROCESSING') && !workerEnabled) return `邮件仍在队列中，发送处理器未启动，不会自动发送；请另行联系${recipient}。`;
  const text: Record<BookingOrderEmailState, string> = {
    QUEUED: '邮件已进入发送队列，尚未确认受理。', PROCESSING: '邮件正在处理，尚未确认受理。',
    ACCEPTED: `邮件服务已受理；这不代表${recipient}已经收到或阅读邮件。`, NOT_CONFIGURED: `邮件发送尚未配置，当前订单没有确认发送；请另行联系${recipient}。`,
    FAILED: `本次邮件发送失败，尚未确认${recipient}收到；请另行联系${recipient}。`, ACCEPTANCE_UNKNOWN: '邮件是否被服务商受理暂不确定，请核对后处理，勿据此重复发送。',
    CANCELLED: `此邮件任务已取消，不能据此判断${recipient}是否收到此前通知。`, NOT_REQUESTED: `此订单尚无邮件发送记录，不能据此判断已经通知${recipient}。`,
  };
  return status ? text[status] : '邮件状态暂无法核对，请重新读取；不能据此判断已经发送或送达。';
}
export class OrderEmailReadFence {
  private scope = ''; private version = 0;
  setScope(scope: string) { if (this.scope !== scope) { this.scope = scope; this.version++; } }
  begin() { return ++this.version; }
  current(ticket: number) { return ticket === this.version; }
  invalidate() { this.version++; }
}
