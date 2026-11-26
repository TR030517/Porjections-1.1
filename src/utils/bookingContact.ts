import { bookingReceptionCustomer } from './bookingReception';

/** Only the authorized booking response supplies a recorded contact. A live
 * account fallback is labelled separately and never presented as a snapshot. */
export function bookingContactDetails(booking: { contact?: unknown; reception?: unknown } | null | undefined) {
  const raw = booking?.contact;
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const name = typeof value.name === 'string' ? value.name : '';
  const phone = typeof value.phone === 'string' ? value.phone : '';
  const email = typeof value.email === 'string' ? value.email : '';
  const guest = value.source === 'GUEST_ASSISTED' && value.emailVerifiedAt === null;
  const recorded = value.recorded === true && value.version === 1 && (value.source === 'ONLINE_VERIFIED' || guest)
    && name.trim() === name && name.length > 0 && Array.from(name).length <= 100 && !/[\p{Cc}\p{Cs}]/u.test(name)
    && /^\+[1-9][0-9]{6,14}$/.test(phone) && (guest && value.email === null || email.length <= 255 && /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email));
  if (recorded) return { recorded: true, name, phone, phoneHref: `tel:${phone}`, email: email || null,
    label: guest ? '商家代约联系人（未关联顾客账号；邮箱未验证，不发送顾客邮件）' : '本次预约联系人（下单时记录）' };
  const historical = raw == null || value.recorded === false && value.version === null
    && ['name', 'phone', 'email', 'source', 'emailVerifiedAt'].every(key => value[key] == null);
  if (!historical) return { recorded: false, name: null, phone: null, phoneHref: null, email: null, label: '本次预约联系人记录无法核验，请检查订单详情。' };
  const legacy = bookingReceptionCustomer(booking?.reception);
  return { recorded: false, ...legacy, email: null, label: '历史订单未记录当次联系人；以下为当前账号资料（如有）' };
}
