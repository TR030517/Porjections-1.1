export const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const roomLabels = { SINGLE: '单人房间', COUPLE: '双人房间', FOOT_SEAT: '独立足疗座位' };
export const minuteLabel = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export function timeMinute(value: string, allowEnd = false) {
  if (allowEnd && value === '24:00') return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('请输入有效的HH:mm时间。');
  const [h, m] = value.split(':').map(Number); return h * 60 + m;
}
export function shopLocal(instant: string, timezone: string | null) {
  if (!timezone || !Number.isFinite(Date.parse(instant))) throw new Error('请先设置有效门店时区。');
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).map(v => [v.type, v.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch { throw new Error('门店时区无效，请联系平台修正。'); }
}
// Shop wall-clock input is resolved explicitly; browser timezone is never used.
export function shopUtc(local: string, timezone: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(local)) throw new Error('请输入完整的当地日期与时间。');
  const nominal = Date.parse(local + ':00Z');
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 16) !== local) throw new Error('当地日期无效。');
  const matches = new Set<number>();
  for (const delta of [-24, -12, 0, 12, 24]) {
    const probe = nominal + delta * 3600000;
    const offset = Date.parse(shopLocal(new Date(probe).toISOString(), timezone) + ':00Z') - probe;
    const candidate = nominal - offset;
    if (shopLocal(new Date(candidate).toISOString(), timezone) === local) matches.add(candidate);
  }
  if (matches.size !== 1) throw new Error('该当地时间因夏令时跳过或重复，请选择明确的时间。');
  return new Date([...matches][0]).toISOString();
}
export function intervalLabel(start: string, end: string, timezone: string | null) {
  try { return `${shopLocal(start, timezone).replace('T', ' ')} – ${shopLocal(end, timezone).replace('T', ' ')}`; }
  catch { return `${start} – ${end} (UTC)`; }
}
