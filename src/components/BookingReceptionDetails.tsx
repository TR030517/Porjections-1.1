import type { BookingDetail } from '../types/bookingDetails';
import { bookingItemResources, bookingLegacyResources, bookingServiceSummary } from '../utils/bookingReception';
import { bookingContactDetails } from '../utils/bookingContact';

export function BookingResourceNames({ item, booking }: { item?: BookingDetail['items'][number]; booking: BookingDetail }) {
  const assigned = item ? bookingItemResources(item, booking.reception) : bookingLegacyResources(booking);
  return <p className="text-xs leading-6 text-slate-500">技师：{assigned.therapists.length ? assigned.therapists.map(row => row.label).join('、') : '分配未记录'}{assigned.room ? ' · 场地：' + assigned.room.label : ''}{typeof item?.preparationMin === 'number' ? ' · 后续衔接准备 ' + item.preparationMin + ' 分钟' : ''}</p>;
}

export default function BookingReceptionDetails({ booking }: { booking: BookingDetail }) {
  const customer = bookingContactDetails(booking);
  return <section aria-label="预约接待信息" className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
    <h4 className="text-sm font-semibold text-slate-800">接待信息</h4>
    <p className="text-xs text-slate-500">{customer.label}</p>
    {(customer.email || customer.recorded) && <p className="break-all text-sm text-slate-800">联系邮箱：{customer.email ?? '未填写邮箱'}</p>}
    <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">顾客</dt><dd className="mt-1 break-words text-slate-800">{customer.name || '顾客姓名未提供'}</dd></div><div><dt className="text-xs text-slate-500">联系电话</dt><dd className="mt-1 break-all text-slate-800">{customer.phoneHref ? <a className="text-teal-700 underline" href={customer.phoneHref}>{customer.phone}</a> : customer.phone || '联系电话未提供'}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-slate-500">已订项目／规格</dt><dd className="mt-1 whitespace-pre-line break-words text-slate-800">{bookingServiceSummary(booking)}</dd></div></dl>
    {!booking.items?.length && <BookingResourceNames booking={booking} />}
  </section>;
}
