import { apiRequest, ApiError } from './session';

export interface AuditFilters {
  targetType?: string; action?: string; targetId?: string; operatorId?: string;
  startDate?: string; endDate?: string;
}
export interface AuditLogItem {
  id: string; action: string; targetType: string; targetId: string;
  operatorId: string; createdAt: string; detail: unknown;
}
export interface AuditLogPage {
  items: AuditLogItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}
export const AUDIT_TARGETS: Record<string, string> = {
  SHOP: '门店（旧审核接口）', stores: '门店', applications: '门店申请',
  USER: '用户（账户接口）', users: '用户', admins: '管理员账户', merchants: '商家账户',
  BOOKING: '预约（订单接口）', 'service-orders': '服务订单', services: '服务项目',
  technicians: '技师', regions: '地区', industries: '行业', coupons: '优惠券',
  'gift-cards': '礼品卡产品', 'gift-card-orders': '礼品卡订单', 'after-sales': '售后申请',
  withdrawals: '提现申请', content: '内容', settings: '平台设置',
  PLATFORM_CONFIG: '平台配置', CATEGORY: '分类', merchant_profiles: '门店账本',
  AFTER_SALES: '售后工单', GIFT_CARD_SHOP: '门店礼品权益',
  SHOP_ACCOUNT: '门店独立账号与授权', PUBLIC_INTAKE: '公开资料导入', CATALOG_IMPORT: '批量价目录入',
};
export const AUDIT_ACTIONS: Record<string, string> = {
  PUBLIC_INTAKE_APPLY: '导入或核对门店公开资料',
  CATALOG_IMPORT_APPLY: '批量新增停用项目与规格',
  BOOKING_RESCHEDULE: '预约改期', BOOKING_ZERO_SETTLEMENT: '记录零额结算',
  STUDIO_CREATE: '新增记录', STUDIO_UPDATE: '更新记录', STUDIO_DISABLE: '停用记录',
  APPROVE: '通过审核', REJECT: '拒绝审核', REQUEST_INFO: '要求补充资料',
  USER_ACTIVE: '启用账户', USER_SUSPENDED: '停用账户', USER_DELETED: '注销账户',
  DISPUTE_DISMISS: '驳回订单争议', PROFILE_CREATE: '建立门店账本',
  UPDATE_CONFIG: '更新平台配置', SEED_CONFIG: '初始化平台配置',
  CREATE_CATEGORY: '新增分类', UPDATE_CATEGORY: '更新分类', DELETE_CATEGORY: '删除分类',
  AFTER_SALES_CREATE: '提交售后工单', AFTER_SALES_CLAIM: '接手售后工单', AFTER_SALES_NOTE: '补充售后记录',
  AFTER_SALES_ACCEPT: '受理售后申请', AFTER_SALES_WAIT_FOR_CUSTOMER: '等待顾客补充', AFTER_SALES_RESUME: '继续处理售后',
  AFTER_SALES_REJECT: '驳回售后申请', AFTER_SALES_RESOLVE: '解决售后工单', AFTER_SALES_WITHDRAW: '撤回售后申请',
  AFTER_SALES_REFUND_REQUESTED: '提交工单退款', AFTER_SALES_REFUND_PENDING: '退款渠道处理中', AFTER_SALES_REFUND_RETRYABLE: '退款待同步', AFTER_SALES_REFUND_SUCCEEDED: '退款已成功', AFTER_SALES_REFUND_FAILED: '退款失败', AFTER_SALES_REFUND_RECONCILIATION_REQUIRED: '退款需要同步核对',
  GIFT_ORDER_CREATE: '创建礼品卡待付款订单', GIFT_ORDER_CANCEL: '取消礼品卡待付款订单', GIFT_PROMOTIONAL_GRANT: '赠送门店权益', GIFT_REDEEM: '核销门店权益', GIFT_PROMOTIONAL_VOID: '作废赠送权益',
  SHOP_LOGIN_CREATED_AND_BOUND: '创建并绑定门店账号', SHOP_LOGIN_BOUND: '绑定门店账号', SHOP_ACCOUNT_GRANTED: '配置门店关联授权', SHOP_ACCOUNT_REVOKED: '撤销门店关联授权', SHOP_LOGIN_PASSWORD_RESET: '重置门店账号密码', SHOP_CONFIG_COPIED: '复制门店配置',
};
const FIELD_LABELS: Record<string, string> = {
  name: '名称', shortName: '简称', category: '分类', industryId: '行业关联', stateId: '州关联',
  cityId: '城市关联', timezone: '时区', businessHours: '营业时间', businessPeriod: '营业时段',
  workDate: '营业日期', address: '地址', addr: '地址', phones: '联系电话字段',
  contactName: '联系人字段', description: '说明', imageUrls: '图片', features: '功能开关',
  serviceIds: '服务关联', priceCents: '价格', durationMin: '时长', isActive: '启用状态',
  sortOrder: '排序', ownerId: '所有者关联', role: '角色', avatarUrl: '头像', level: '级别',
  intro: '简介', title: '标题', type: '类型', content: '内容', startDate: '开始日期',
  endDate: '结束日期', amount: '面额', threshold: '使用门槛', merchantShortLink: '商家关联',
  validityDays: '有效天数', useTimes: '使用次数', priceOptions: '价格规格', status: '状态',
  gender: '性别字段', experienceYears: '从业年限', specialties: '擅长项目', regionId: '地区关联',
  parentId: '父级关联', shortLink: '短链接',
  loginName: '独立登录名', loginBinding: '门店登录绑定', linkedAccountAccess: '关联访问权限', passwordReset: '密码重置', services: '服务配置', variants: '服务规格',
};
const STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理', APPROVED: '已通过', REJECTED: '已拒绝', SUSPENDED: '已停用',
  ACTIVE: '已启用', DISABLED: '已停用', DELETED: '已注销', CONFIRMED: '已确认',
  COMPLETED: '已完成', CANCELLED: '已取消', REFUNDING: '退款处理中', REFUNDED: '已退款',
  UNPAID: '未付款', PAID: '已付款', PARTIALLY_REFUNDED: '部分退款', NORMAL: '正常',
  CLOSED: '已关闭', PAUSED: '已暂停', 正常: '正常', 关闭: '已关闭',
  OPEN: '待受理', IN_PROGRESS: '处理中', WAITING_CUSTOMER: '待顾客回复', RESOLVED: '已解决', WITHDRAWN: '已撤回', EXHAUSTED: '已用完', EXPIRED: '已过期', VOIDED: '已作废',
};
const own = (map: Record<string, string>, key: unknown) =>
  typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : undefined;

/** Defense in depth: render a closed set of summaries even if an API returns extra JSON. */
export function safeAuditSummary(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const detail = value as Record<string, unknown>;
  const lines: string[] = [];
  if (Array.isArray(detail.fields)) {
    const fields = [...new Set(detail.fields.slice(0, 100).map(field => own(FIELD_LABELS, field)).filter(Boolean))];
    if (fields.length) lines.push('变更字段：' + fields.join('、'));
  }
  const before = own(STATUS_LABELS, detail.previousStatus), after = own(STATUS_LABELS, detail.newStatus);
  if (before || after) lines.push(before && after ? `状态：${before} → ${after}` : before ? `原状态：${before}` : `新状态：${after}`);
  if (detail.reasonRecorded === true) lines.push('已记录处理原因（原文不在此展示）');
  if (typeof detail.revokedSessions === 'number' && Number.isSafeInteger(detail.revokedSessions) && detail.revokedSessions >= 0) lines.push(`已撤销登录会话：${detail.revokedSessions} 个`);
  if (typeof detail.internalZeroBalance === 'boolean') lines.push(detail.internalZeroBalance ? '以零余额建立内部账本' : '非零余额初始化标记');
  if (typeof detail.externalPaymentsEnabled === 'boolean') lines.push('外部支付标记：' + (detail.externalPaymentsEnabled ? '已启用' : '未启用'));
  return lines;
}
export const auditTargetLabel = (value: string) => own(AUDIT_TARGETS, value) ?? '其他目标';
export const auditActionLabel = (value: string) => own(AUDIT_ACTIONS, value) ?? '其他操作';

function validId(value: string) { return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n; }
function validDate(value: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function auditQuery(filters: AuditFilters, page: number, limit: number): URLSearchParams {
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError('分页参数无效。');
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  for (const [key, raw] of Object.entries(filters)) {
    const value = raw?.trim();
    if (!value) continue;
    if (key === 'targetType' && !/^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(value)) throw new ApiError('目标类型仅支持 1–50 位字母、数字、横线或下划线。');
    if (key === 'action' && !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(value)) throw new ApiError('动作代码仅支持 1–100 位字母、数字、横线或下划线。');
    if ((key === 'targetId' || key === 'operatorId') && !validId(value)) throw new ApiError('实体 ID 和操作者 ID 须为有效的正整数 ID。');
    if ((key === 'startDate' || key === 'endDate') && !validDate(value)) throw new ApiError('请填写有效的 UTC 日期。');
    if (['targetType', 'action', 'targetId', 'operatorId', 'startDate', 'endDate'].includes(key)) params.set(key, value);
  }
  if (params.has('startDate') && params.has('endDate') && params.get('startDate')! > params.get('endDate')!) throw new ApiError('开始日期不能晚于结束日期。');
  return params;
}
export async function listAuditLogs(filters: AuditFilters, page = 1, limit = 20, signal?: AbortSignal): Promise<AuditLogPage> {
  const result = await apiRequest<AuditLogPage>('/admin/audit-logs?' + auditQuery(filters, page, limit), { signal });
  if (!Array.isArray(result?.items) || !result.meta || !Number.isSafeInteger(result.meta.total) || result.meta.total < 0 || result.meta.page !== page || result.meta.limit !== limit || !Number.isSafeInteger(result.meta.totalPages) || result.meta.totalPages < 0 || result.items.length > limit) throw new ApiError('审计列表格式无效，请重试。');
  if (result.items.some(item => !item || ![item.id, item.targetId, item.operatorId].every(id => typeof id === 'string' && validId(id)) || typeof item.action !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(item.action) || typeof item.targetType !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(item.targetType) || typeof item.createdAt !== 'string' || !Number.isFinite(new Date(item.createdAt).getTime()))) throw new ApiError('审计记录格式无效，请重试。');
  return result;
}
