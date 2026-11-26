const labels: Record<string, string> = {
  PENDING: '待处理', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELLED: '已取消', EXPIRED: '已过期', FAILED: '失败', SUCCEEDED: '已成功', PROCESSING: '处理中', RETRYABLE: '可重试', UNKNOWN: '结果待核实',
  UNPAID: '未付款', PAID: '已付款', REFUNDING: '退款中', PARTIALLY_REFUNDED: '部分退款', REFUNDED: '已退款',
  ONLINE: '在线预付', PAY_AT_STORE: '到店付款', ZERO: '零金额结算', PAYMENT: '收款', REFUND: '退款', PAYOUT: '提现',
  ACTIVE: '已启用', INACTIVE: '已停用', SUSPENDED: '已停用', DISABLED: '已停用', REVOKED: '已撤销', DRAFT: '草稿', PAUSED: '已暂停', EXHAUSTED: '已用完', VOIDED: '已作废',
  OPEN: '待处理', IN_PROGRESS: '处理中', WAITING_CUSTOMER: '等待顾客', RESOLVED: '已解决', REJECTED: '已拒绝', WITHDRAWN: '已撤回',
  RESCHEDULE: '改期', COMPLAINT: '投诉', OTHER: '其他', PUBLIC: '顾客可见', INTERNAL: '内部',
  ADMIN: '公司管理员', MERCHANT: '商家', OWNER: '店主', STAFF: '员工', CUSTOMER: '顾客', SYSTEM: '系统',
  PROMOTIONAL: '促销赠送', PURCHASE: '购买', PURCHASED: '购买', LEGACY: '历史导入',
  MASSAGE: '按摩', REFLEXOLOGY: '足部按摩', CUPPING: '拔罐', SCRAPING: '刮痧', HEAD_THERAPY: '头疗',
  NONE: '尚未开始', IN_FLIGHT: '正在执行', ACCEPT: '接受申请', WAIT_FOR_CUSTOMER: '等待顾客', RESUME: '继续处理', REJECT: '拒绝申请', RESOLVE: '解决工单', WITHDRAW: '撤回工单', REFUND_PENDING: '退款处理中', REFUND_RETRYABLE: '退款待重试', REFUND_SUCCEEDED: '退款成功', REFUND_FAILED: '退款失败',
  CREATED: '创建工单', CLAIMED: '接手工单', NOTE: '添加备注', NOTE_ADDED: '添加备注', ACCEPTED: '接受申请', STATUS_CHANGED: '状态变更', REFUND_REQUESTED: '发起退款', REFUND_UPDATED: '更新退款结果', REFUND_RECONCILED: '核对退款结果',
};
export function displayLabel(value: string | null | undefined, fallback = '未识别状态'): string {
  if (!value) return '—';
  return labels[value] ?? (/[\u3400-\u9fff]/u.test(value) ? value : fallback);
}
