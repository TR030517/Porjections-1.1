import { shopPublication } from '../../common/shop-publication';
import { shopEligibility } from '../../common/shop-eligibility';
import { shopFeatures } from '../../common/shop-features';
import { shopPaymentPolicy } from '../../common/shop-payment-policy';
import { publicShopProfile } from '../../common/shop-public-profile';
import { recurringScheduleCheck, type WeeklyShift } from '../booking/work-schedule';
import { activeReservationOptions, validReservationOption } from '../../common/service-reservation-options';
import { readDurationKind, validReservedDurationMin } from '../../common/service-duration';
import { bookingOnlinePaymentEnabled } from '../../common/order-mode';
import { verifiedShopOrderEmailRecipient } from '../../common/shop-order-email-settings';
import type { ReadinessAction, ReadinessCheck, ShopReadiness } from './shop-readiness.contract';

export interface ReadinessSnapshot {
  shop: any; services: any[]; variants: any[]; therapists: any[]; qualifications?: any[]; shifts: any[]; rooms: any[]; images: any[];
  orderEmailDelivery?: { configured: boolean; mode: 'LOCAL_CAPTURE' | 'PROVIDER' | null; workerEnabled: boolean };
}
const check = (key: string, label: string, state: ReadinessCheck['state'], detail: string, action?: ReadinessAction): ReadinessCheck => ({ key, label, state, detail, ...(action ? { action } : {}) });
const basisValid = (value: unknown) => value == null || value === 'PER_PERSON' || value === 'PER_BOOKING';
const basisName = '整次订单总价';
const integer = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const pubAction = (key: string): ReadinessAction => key === 'loginAccount' ? { kind: 'accounts' }
  : { kind: 'store-section', section: key === 'hours' ? 'hours' : 'basic' };

/** Saved configuration only: no dates, slot allocator, occupied resources,
 * providers, publication mutation or inference from ownerId/login sessions. */
export function buildShopReadiness(snapshot: ReadinessSnapshot, loginReady: boolean, checkedAt = new Date().toISOString()): ShopReadiness {
  const { shop } = snapshot, publication = shopPublication(shop, shop.owner, loginReady), eligibility = shopEligibility(shop, loginReady), features = shopFeatures(shop.studioProfile);
  const paymentPolicy = shopPaymentPolicy(shop.studioProfile), profile = publicShopProfile(shop, snapshot.images);
  const orderOnly = !bookingOnlinePaymentEnabled(), storeOrderEmailVerified = !!verifiedShopOrderEmailRecipient(shop.orderEmailSetting);
  const mail = snapshot.orderEmailDelivery;
  const storeOrderEmailReady = storeOrderEmailVerified && mail?.configured === true && mail.mode === 'PROVIDER' && mail.workerEnabled === true;
  const qualified = [...new Map(snapshot.therapists.filter(row => row.isActive === true && String(row.shopId) === String(shop.id))
    .map(row => [String(row.id), row])).values()];
  const shiftsByTherapist = new Map<string, WeeklyShift[]>();
  for (const shift of snapshot.shifts) {
    const therapistId = String(shift.therapistId);
    const savedShifts = shiftsByTherapist.get(therapistId);
    if (savedShifts) savedShifts.push(shift);
    else shiftsByTherapist.set(therapistId, [shift]);
  }
  const hasRecurringShift = recurringScheduleCheck(shop.businessHours);
  const scheduled = new Set(qualified.filter(row => hasRecurringShift({ scheduleMode: row.scheduleMode, shifts: shiftsByTherapist.get(String(row.id)) ?? [] })));
  const firstRelevant = qualified.find(row => !scheduled.has(row)) ?? qualified[0];
  const services: ShopReadiness['services'] = snapshot.services.map(service => {
    const sid = String(service.id), action: ReadinessAction = { kind: 'reservation', tab: 'services', serviceId: sid };
    const variants = snapshot.variants.filter(row => String(row.serviceId) === sid);
    const active = service.isActive === true;
    let kind: ReturnType<typeof readDurationKind> | null = null;
    try { kind = readDurationKind(service.durationKind); } catch { /* Invalid saved policy becomes a finding rather than a publication mutation. */ }
    const kindLabel = kind === 'PER_SESSION' ? '按次' : kind === 'VARIABLE' ? '时长不固定' : kind === 'TIMED' ? '固定时长' : '类型待修正';
    // Disabled services expose preparation suggestions as INFO, never a
    // publication blocker or a finding on the active-service summary.
    const diagnostic = (key: string, label: string, ok: boolean, detail: string, target: ReadinessAction = action) =>
      check(key, label, !active ? 'INFO' : ok ? 'PASS' : 'ATTENTION', detail, target);
    const roomType = service.requiredRoomType;
    const policyValid = [1, 2].includes(service.participantCount) && [1, 2].includes(service.requiredStaffCount) && service.requiredStaffCount >= service.participantCount
      && (!roomType || ['SINGLE', 'COUPLE', 'FOOT_SEAT'].includes(roomType)) && (service.participantCount !== 2 || !roomType || roomType === 'COUPLE')
      && integer(service.staffBufferMin, 0, 120) && integer(service.roomBufferMin, 0, 120) && (variants.length > 0 || basisValid(service.priceBasis));
    const checks: ReadinessCheck[] = [check('active', '项目启用状态', active ? 'PASS' : 'INFO', active ? '项目已启用；仍需核对价目、技师及资源配置。' : '项目当前停用；下列信息用于启用前准备，本检查不会自动启用。', { kind: 'services' }),
      diagnostic('policy', '人数、价格口径及资源政策', policyValid, policyValid
        ? `${service.participantCount}人，需${service.requiredStaffCount}名不同技师；${variants.length ? '整次订单总价与预留以启用规格为准' : basisName}，不按顾客或技师人数重复计价；技师缓冲${service.staffBufferMin}分钟、空间缓冲${service.roomBufferMin}分钟。`
        : '请核对1至2人的参与人数、足够的技师（单人1名、情侣2名、四手2名）、价格口径及0至120分钟缓冲。空间为可选；情侣项目如绑定空间，须选择双人房。')];
    const usableOptions = activeReservationOptions({ ...service, variants });
    const durationValid = variants.length ? usableOptions.length > 0 : validReservedDurationMin(service.durationKind, service.durationMin);
    const durationDetail = variants.length
      ? kind ? `${kindLabel}；${usableOptions.length}个启用有效规格，预约预留${[...new Set(usableOptions.map(row => row.durationMin))].sort((a, b) => a - b).join('／') || '待配置'}分钟。实际价格和预留以所选规格为准，基础金额与基础时长不用于预约。`
        : '服务类型无效，请先修正主服务类型；规格不能覆盖无效类型。'
      : kind ? `${kindLabel}；基础预约预留${service.durationMin}分钟。${kind === 'TIMED' ? '固定服务时长与预约块一致。' : '预留块用于防止资源冲突，不将实际服务承诺为固定分钟；整次订单总价单独配置。'}`
        : '服务类型无效，请选择固定时长、按次或时长不固定，并明确5至240整数分钟预约预留。';
    checks.push(diagnostic('durationPolicy', '服务类型与预约预留', durationValid, durationDetail));
    if (!variants.length) {
      const valid = validReservationOption(service, service);
      checks.push(diagnostic('price', '基础预约价目', valid, valid
        ? `未配置独立规格，使用${kindLabel}、预约预留${service.durationMin}分钟、USD明确${basisName}。无需为通过检查额外建规格。`
        : '无独立规格时，类型须受支持、预约预留须为5至240整数分钟、价格须为正整数分且存储价格口径可识别；新订单统一按整次总价，服务金额不得超过999999.99美元。'));
    } else {
      const enabled = variants.filter(row => row.isActive === true), valid = usableOptions;
      checks.push(diagnostic('price', '预约预留与价格规格', valid.length > 0,
        `共${variants.length}个规格，其中${enabled.length}个启用、${valid.length}个有效USD规格。已配置规格的项目不会回退基础价；停用规格不计作错误。`));
      checks.push(diagnostic('variantValidity', '启用规格的价目有效性', enabled.length === valid.length, enabled.length === valid.length
        ? '启用规格继承主服务类型，预约预留均符合5至240整数分钟、正整数分USD价格、受支持价格口径及整单服务金额上限。'
        : `${enabled.length - valid.length}个启用规格不符合主服务类型、预约预留、USD币种、正整数分价格、价格口径或整单999999.99美元金额上限，请核对。`));
    }
    const needed = [1, 2].includes(service.requiredStaffCount) ? service.requiredStaffCount : null;
    checks.push(diagnostic('staff', '本店启用技师', needed !== null && qualified.length >= needed,
      `${qualified.length}名不同的本店启用技师默认承接本店全部项目${needed === null ? '；请先修正参与人数。' : `，配置至少需${needed}名。`}`, { kind: 'technicians' }));
    checks.push(diagnostic('shifts', '本店技师的工作时间', needed !== null && scheduled.size >= needed,
      `${scheduled.size}名本店启用技师的每周班次与门店营业时间重叠${needed === null ? '' : `，此项目至少需${needed}名`}。此项只统计每位技师的排班，实际预约还需检查班次能否同时覆盖服务所需时长。`,
      { kind: 'reservation', tab: 'therapists', ...(firstRelevant ? { therapistId: String(firstRelevant.id) } : {}) }));
    if (!roomType) checks.push(check('room', '房间或独占座位', 'INFO', '此项目未要求空间资源；无需为了通过检查额外建立房间。', { kind: 'reservation', tab: 'rooms' }));
    else {
      const rooms = snapshot.rooms.filter(row => row.isActive === true && String(row.shopId) === String(shop.id) && ['SINGLE', 'COUPLE', 'FOOT_SEAT'].includes(roomType) && row.roomType === roomType
        && needed !== null && Number.isInteger(row.capacity) && row.capacity >= service.participantCount);
      checks.push(diagnostic('room', '匹配的房间或独占座位', rooms.length > 0,
        `有${rooms.length}个启用的本店匹配房型且容量足够的资源。只统计配置，未核对维护或当前占用。`, { kind: 'reservation', tab: 'rooms' }));
    }
    return { id: sid, name: service.name, isActive: active, mode: variants.length ? 'VARIANTS' : 'LEGACY', checks };
  });
  const activeServices = services.filter(service => service.isActive);
  return {
    schemaVersion: 1, checkedAt, shop: { id: String(shop.id), name: shop.name, status: shop.status },
    publication: { ready: publication.publicationReady, publicVisible: eligibility.publicVisible, checks: [
      ...publication.publicationChecklist.map(item => check(item.key, item.label, item.complete ? 'PASS' : 'ATTENTION', item.complete ? '已保存资料符合现有发布条件。' : '已保存资料尚不符合此项发布条件，请进入对应页面补充。', pubAction(item.key))),
      check('publicStatus', '当前对外展示状态', eligibility.publicVisible ? 'PASS' : 'ATTENTION', eligibility.publicVisible ? '当前已具备现有公开展示资格。' : '当前不对外展示；请核对门店发布状态。', { kind: 'store-section', section: 'review' }),
    ] },
    access: { loginReady, checks: [check('loginReady', '独立门店账号可登录条件', loginReady ? 'PASS' : 'ATTENTION', loginReady
      ? '绑定账号符合现有角色、启用状态、登录标识和密码封装要求；不代表已验证具体密码或实际登录。'
      : '未绑定可用独立账号，或账号状态、登录标识、密码封装或标识歧义需处理。请在账号权限页面核对本店。', { kind: 'accounts' })] },
    booking: { enabled: features.onlineBooking, payAtStoreEnabled: paymentPolicy.payAtStoreEnabled, checks: [
      check('onlineBooking', '顾客在线预约开关', features.onlineBooking ? 'PASS' : 'ATTENTION', features.onlineBooking ? '门店在线预约开关已开启；仍受公开资格及实际时段检查限制。' : '门店在线预约开关已关闭；本检查不会自动开启。', { kind: 'store-section', section: 'hours' }),
      check('activeServices', '启用的服务项目', activeServices.length ? 'PASS' : 'ATTENTION', `有${activeServices.length}个启用项目、${services.length - activeServices.length}个停用项目；停用项目不会自动启用。`, { kind: 'services' }),
      check('storeOrderEmail', '预约通知收件邮箱', storeOrderEmailReady ? 'PASS' : 'ATTENTION', storeOrderEmailReady
        ? '专用预约通知邮箱已完成收件验证，邮件服务和发送任务已启用；不代表具体订单已经发送或收到。请在订单详情核对状态；旧任务保留原目的地指纹，不会改寄新地址。'
        : '订单仍保存在后台，但门店收单邮件无法发送。' + (!storeOrderEmailVerified
          ? '请在专用预约通知设置中验证收件邮箱；公开联系邮箱和登录邮箱不等于收件权已验证。'
          : mail?.mode === 'LOCAL_CAPTURE' ? '当前仅本地捕获，未向真实邮箱发送；仍需外部服务实收验收。'
          : mail?.workerEnabled === false ? '当前发送任务已停用，请联系平台管理员处理。'
          : '邮件服务未配置或状态尚未核对，请联系平台管理员处理。') + '已有任务不会自动补投或改寄，邮件故障不删除预约。',
        { kind: 'store-section', section: 'basic' }),
      check('payAtStore', orderOnly ? '预约订单线下处理' : '到店付款政策', 'INFO', orderOnly
        ? '当前只创建预约订单，款项由门店与顾客线下处理；不受旧到店付款政策开关限制，不要求先登记收款。'
        : paymentPolicy.payAtStoreEnabled ? '已明确允许顾客选择到店付款。此政策不代表已收款。' : '尚未选择允许到店付款；是否开启请按门店实际经营政策决定。',
        orderOnly ? undefined : { kind: 'reservation', tab: 'services' }),
      check('onlinePayment', '外部在线支付渠道', 'INFO', orderOnly
        ? '当前未开放新订单在线收款；旧在线订单的实际款项、对账和售后记录继续保留。'
        : '本次未验证真实支付渠道、密钥、到账账户或回调；不能由门店资料推断渠道已可用。'),
    ] },
    presentation: { checks: [
      check('cover', '顾客页面封面图片', profile.media.coverUrl ? 'PASS' : 'INFO', profile.media.coverUrl ? '已配置公开资料可用的封面图片地址；未验证图片网络可达性。' : '建议补充真实门店封面以完善顾客页面；这是展示建议，不影响现有发布条件。', { kind: 'store-section', section: 'brand' }),
      check('gallery', '顾客页面相册', profile.media.galleryUrls.length ? 'PASS' : 'INFO', `公开资料有${profile.media.galleryUrls.length}张相册图片；可补充环境与设施照片，未验证网络可达性。`, { kind: 'store-section', section: 'brand' }),
      check('description', '面向顾客的英文介绍', profile.about ? 'PASS' : 'INFO', profile.about ? '已保存顾客介绍。建议人工核对英文内容，本检查不判断语言或文案质量。' : '建议补充英文门店介绍，方便顾客了解服务；不作为发布硬条件。', { kind: 'store-section', section: 'basic' }),
    ] },
    services, summary: { activeServices: activeServices.length, disabledServices: services.length - activeServices.length,
      activeServicesWithFindings: activeServices.filter(service => service.checks.some(item => item.state === 'ATTENTION')).length },
    limitations: ['仅检查当前已保存资料的一致快照，未保存草稿不会计入。', '本店启用技师默认承接本店全部项目；只统计服务、技师、班次与空间配置，不验证实际可预约时段、班次同时覆盖、营业时长、夏令时、休假、维护或当前占用。',
      '仅核对门店收单联系邮箱格式，未核验真实发信服务、邮箱所有权或实际收信；不保证已通知门店。',
      '未核验真实在线支付渠道、外部网络或具体账号密码；不能据此承诺可登录、可付款或已有空位。', '检查不会自动启用服务、发布门店、创建预约或更改付款政策；最终预约仍由服务器实际时段检查决定。'],
  };
}
