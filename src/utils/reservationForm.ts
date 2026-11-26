import type { ReservationForm, ReservationFormKind, ReservationPriceBasis } from '../types/reservations';
import { projectMetadataPriceCents } from './projectMetadata';

/** Editable USD only; API prices remain integer cents with the variant's existing ceiling. */
export function reservationVariantPriceCents(value: unknown): number {
  const cents = projectMetadataPriceCents(typeof value === 'string' && /^\.\d{1,2}$/.test(value) ? '0' + value : value);
  if (cents > 10000000) throw Error('整次订单固定价格须为0.01–100000.00美元。');
  return cents;
}
export const reservationVariantPriceDraft = (cents: number) => (cents / 100).toFixed(2);

export const RESERVATION_WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const ROOM_LABELS = { SINGLE: '单人房', COUPLE: '双人房', FOOT_SEAT: '独占足疗座位' };
export const RESERVATION_PRICE_LABELS = { PER_PERSON: '每人价', PER_BOOKING: '整单价' };
export function reservationPriceBasis(value: unknown): ReservationPriceBasis {
  if (value === undefined) return 'PER_BOOKING';
  if (value !== 'PER_PERSON' && value !== 'PER_BOOKING') throw new Error('请选择每人价或整单价。');
  return 'PER_BOOKING';
}
export function reservationServiceTotal(cents: number, count: number, basis: unknown) {
  reservationPriceBasis(basis);
  const total = cents;
  if (!Number.isSafeInteger(cents) || cents < 1 || ![1, 2].includes(count) || !Number.isSafeInteger(total)) throw new Error('服务金额或人数无效。');
  return total;
}
function integer(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(label + '须为整数。');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(label + '须在 ' + min + '–' + max + ' 之间。');
  return number;
}
function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('请填写' + label + '，最多 ' + max + ' 字。');
  return value.trim();
}
export function minuteLabel(minutes: number) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
export function timeMinute(value: unknown, allowMidnight = false) {
  if (allowMidnight && value === '24:00') return 1440;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('请填写有效的 HH:mm 时间。');
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
export function localReservationTime(iso: string, timezone: string | null) {
  if (!timezone) throw new Error('请先在门店工作室设置有效时区。');
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) throw new Error('日期时间无效。');
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch { throw new Error('门店时区无效，请先在门店工作室修正。'); }
}
// Resolve an explicitly entered shop-local minute. Missing/repeated DST minutes fail closed.
export function reservationUtc(local: string, timezone: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(local)) throw new Error('请填写完整的日期时间。');
  const nominal = Date.parse(local + ':00Z');
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 16) !== local) throw new Error('日期时间无效。');
  const matches = new Set<number>();
  for (const delta of [-24, -12, 0, 12, 24]) {
    const probe = nominal + delta * 3600000;
    const offset = Date.parse(localReservationTime(new Date(probe).toISOString(), timezone) + ':00Z') - probe;
    const candidate = nominal - offset;
    if (localReservationTime(new Date(candidate).toISOString(), timezone) === local) matches.add(candidate);
  }
  if (matches.size !== 1) throw new Error('该门店当地时间因夏令时不存在或重复，请选择明确的时间。');
  return new Date([...matches][0]).toISOString();
}
export function buildReservationPayload(kind: ReservationFormKind, form: ReservationForm, timezone: string | null, creating: boolean): Record<string, unknown> {
  const isActive = form.isActive === true;
  if (kind === 'policy') {
    const participants = integer(form.participantCount, '服务人数', 1, 2);
    const staff = integer(form.requiredStaffCount ?? String(participants), '所需技师人数', 1, 2);
    if (participants === 2 && staff !== 2) throw new Error('双人服务必须配置两位不同技师。');
    const room = form.requiredRoomType === '' ? null : form.requiredRoomType;
    if (room !== null && !Object.hasOwn(ROOM_LABELS, String(room))) throw new Error('请选择有效的房间类型。');
    if (participants === 2 && room !== null && room !== 'COUPLE') throw new Error('双人服务如绑定空间，必须选择双人房。');
    return { participantCount: participants, requiredStaffCount: staff, requiredRoomType: room, priceBasis: reservationPriceBasis(form.priceBasis === undefined ? 'PER_BOOKING' : form.priceBasis),
      staffBufferMin: integer(form.staffBufferMin, '员工收尾缓冲', 0, 120), roomBufferMin: integer(form.roomBufferMin, '房间清理缓冲', 0, 120) };
  }
  if (kind === 'schedule') {
    if (form.scheduleMode !== 'SHOP' && form.scheduleMode !== 'CUSTOM') throw new Error('请选择跟随门店或个人例外排班。');
    return { scheduleMode: form.scheduleMode };
  }
  if (kind === 'variants') return {
    ...(creating ? { serviceId: text(form.serviceId, '服务项目', 30) } : {}), name: text(form.name, '规格名称', 100),
    durationMin: integer(form.durationMin, '服务时长／预约预留（分钟）', 5, 240), priceCents: reservationVariantPriceCents(form.priceUsd), priceBasis: reservationPriceBasis(form.priceBasis === undefined ? 'PER_BOOKING' : form.priceBasis),
    currency: 'usd', sortOrder: integer(form.sortOrder, '排序', 0, 10000), isActive,
  };
  if (kind === 'shifts') {
    const startMin = timeMinute(form.startTime); const endMin = timeMinute(form.endTime, true);
    if (endMin <= startMin) throw new Error('班次结束须晚于开始；跨日班次请拆为两天。');
    return { ...(creating ? { therapistId: text(form.therapistId, '技师', 30) } : {}), weekday: integer(form.weekday, '星期', 0, 6), startMin, endMin, isActive };
  }
  if (kind === 'rooms') {
    const roomType = String(form.roomType);
    if (!Object.hasOwn(ROOM_LABELS, roomType)) throw new Error('请选择有效的房间类型。');
    return { name: text(form.name, '空间名称', 100), roomType, capacity: roomType === 'COUPLE' ? 2 : 1, isActive };
  }
  const startAtUtc = reservationUtc(String(form.startLocal ?? ''), timezone);
  const endAtUtc = reservationUtc(String(form.endLocal ?? ''), timezone);
  if (endAtUtc <= startAtUtc) throw new Error('结束时间须晚于开始时间。');
  const reason = String(form.reason ?? '').trim();
  if (reason.length > 500) throw new Error('说明最多 500 字。');
  const parent = kind === 'time-off' ? 'therapistId' : 'roomId';
  return { ...(creating ? { [parent]: text(form[parent], kind === 'time-off' ? '技师' : '空间', 30) } : {}), startAtUtc, endAtUtc, reason: reason || null };
}
