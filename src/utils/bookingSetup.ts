import type { PriceMenuGroup } from './priceMenu';
import { parseWeeklyBusinessHours, weeklyScheduleFit } from './weeklySchedule';

export interface BookingSetupConfig {
  shopId: string | number; timezone: string | null; businessHours?: unknown;
  services: Array<{ id: string | number; name: string; isActive: boolean; durationMin: number; priceCents: number; participantCount: number; requiredStaffCount: number; requiredRoomType: string | null; staffBufferMin?: number; variants: Array<{ isActive: boolean; durationMin: number; priceCents: number; currency?: string }> }>;
  therapists: Array<{ id: string | number; shopId?: string | number; name?: string; isActive: boolean; serviceIds: string[]; scheduleMode?: string; shifts: Array<{ weekday: number; startMin: number; endMin: number; isActive: boolean }> }>;
  rooms: Array<{ isActive: boolean; roomType: string; capacity: number }>;
}
export interface BookingSetupIssue { key: string; serviceId?: string; therapistId?: string; serviceName: string; kind: 'timezone' | 'hours' | 'service' | 'activation' | 'staff' | 'schedule' | 'room'; message: string; action: string; }
export function linkedBookingServices(menu: PriceMenuGroup[]): string[] {
  return [...new Set(menu.flatMap(group => group.items.flatMap(item => item.booking ? [item.booking.serviceId] : [])))];
}
/** A configuration checklist only: no slot search, assignment or business write. */
export function bookingSetupIssues(config: BookingSetupConfig, selectedIds: readonly string[]): BookingSetupIssue[] {
  const issues: BookingSetupIssue[] = [];
  let timezoneValid = false;
  try { if (config.timezone) { new Intl.DateTimeFormat('en', { timeZone: config.timezone }).format(); timezoneValid = true; } } catch { /* An unconfirmed timezone needs store configuration. */ }
  if (!timezoneValid) issues.push({ key: 'timezone', kind: 'timezone', serviceName: '门店基本资料', message: '请先确认门店地址对应的实际时区，预约及订单均使用此时区。', action: '设置门店时区' });
  const periods = parseWeeklyBusinessHours(config.businessHours);
  if (periods === null || !periods.length) issues.push({ key: 'business-hours', kind: 'hours', serviceName: '门店营业设置', message: periods === null ? '营业时间缺失或格式无法核对，请完善门店每周营业时段。' : '门店目前全周休息，尚无可安排服务的营业时段。', action: '完善营业设置' });
  for (const id of [...new Set(selectedIds)]) {
    const service = config.services.find(row => String(row.id) === id);
    const add = (kind: BookingSetupIssue['kind'], message: string, action: string, therapistId?: string) => issues.push({ key: id + ':' + issues.length, serviceId: id, ...(therapistId ? { therapistId } : {}), serviceName: service?.name ?? '关联项目', kind, message, action });
    if (!service) { add('service', '未在当前门店目录中找到关联主项目，请核对关联。', '核对预约项目'); continue; }
    if (!service.isActive) { add('activation', '主项目已暂停，规格和附加项的配置会保留；恢复接单须明确启用主项目。', '主项目启停'); continue; }
    const options = service.variants.length ? service.variants.filter(row => row.isActive) : [service];
    const validOptions = options.filter(row => Number.isInteger(row.durationMin) && row.durationMin >= 5 && row.durationMin <= 240 && Number.isSafeInteger(row.priceCents) && row.priceCents > 0 && row.priceCents <= 99999999 && (!('currency' in row) || row.currency === 'usd'));
    if (!validOptions.length) add('service', '尚无同时具备有效占用时间和价格的启用选项；价格须为正整数分，且整次服务总价不得超过 999999.99 美元。', '完善实际规格');
    const bufferValid = typeof service.staffBufferMin === 'number' && Number.isInteger(service.staffBufferMin) && service.staffBufferMin >= 0 && service.staffBufferMin <= 120;
    if (!bufferValid) add('service', '技师收尾缓冲缺失或无效，请核对 0–120 整数分钟的预约策略。', '完善预约方式');
    if (![1, 2].includes(service.requiredStaffCount) || ![1, 2].includes(service.participantCount) || service.requiredStaffCount < service.participantCount) { add('service', '请核对服务人数与所需技师人数。', '完善预约方式'); continue; }
    const activeStaff = config.therapists.filter(row => row.isActive && (row.shopId === undefined || String(row.shopId) === String(config.shopId)));
    const unique = [...new Map(activeStaff.map(row => [String(row.id), row])).values()];
    if (unique.length < service.requiredStaffCount) add('staff', `本店有 ${unique.length} 位启用技师，本项目需同时安排 ${service.requiredStaffCount} 位不同技师。请按实际人数设置，技师默认承接本店全部项目。`, '设置技师人数');
    if (periods?.length && validOptions.length && bufferValid) {
      // This summary concerns the parent: one valid active option is enough. With shared staff policy,
      // any longer option's feasible start also accommodates the shortest valid option.
      const fit = weeklyScheduleFit({ periods, durationMin: Math.min(...validOptions.map(row => row.durationMin)), staffBufferMin: service.staffBufferMin!, requiredStaffCount: service.requiredStaffCount, therapists: unique });
      if (!fit.hasServiceWindow) add('hours', '当前每段营业时间都无法容纳本项目的有效启用规格，请核对营业时段与预约占用时间。', '完善营业设置');
      else if (unique.length >= service.requiredStaffCount && !fit.hasStaffCoverage) {
        const missing = unique.find(row => fit.withoutShiftIds.includes(String(row.id))), target = missing ?? unique[0];
        const name = (row: typeof target) => row.name?.trim() || `技师 #${row.id}`;
        const message = missing ? `本店技师${name(missing)}没有有效的每周工作时段，当前无法安排足够技师完整覆盖服务与收尾缓冲。`
          : `相关技师：${unique.map(name).join('、')}。每周班次尚无足够技师同时完整覆盖服务与收尾缓冲的共同接待时段。`;
        add('schedule', message, '配置技师排班', String(target.id));
      }
    }
    if (service.requiredRoomType && !['SINGLE', 'COUPLE', 'FOOT_SEAT'].includes(service.requiredRoomType)) add('service', '请选择有效的空间类型，或不绑定空间。', '完善预约方式');
    else if (service.participantCount === 2 && service.requiredRoomType && service.requiredRoomType !== 'COUPLE') add('service', '情侣按摩如绑定空间，需要选择双人房类型；也可不绑定空间。', '完善预约方式');
    else if (service.requiredRoomType && !config.rooms.some(row => row.isActive && row.roomType === service.requiredRoomType && Number.isInteger(row.capacity) && row.capacity >= service.participantCount)) add('room', `尚缺启用且容量至少为 ${service.participantCount} 人的匹配空间。`, '配置空间');
  }
  return issues;
}
