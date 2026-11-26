const knownErrors: Record<string, string> = {
  'The selected shop has no matching owner ledger.': '当前门店没有匹配的店主账本。',
  'Network Error': '网络连接失败，请检查网络后重试。',
  'Failed to fetch': '网络连接失败，请检查网络后重试。',
  'Unauthorized': '登录已失效，请重新登录。',
  'Forbidden resource': '您没有执行此操作的权限。',
  'Too Many Requests': '操作过于频繁，请稍后重试。',
  'Invalid credentials': '账号或密码不正确。',
  'Invalid ID': '编号无效，请核对后重试。',
  'Invalid status': '状态无效，请刷新后重试。',
  'Invalid pagination': '分页参数无效，请刷新列表。',
  'Invalid date range': '日期范围无效，请重新选择。',
  'Coupon not found': '优惠券不存在或已被移除。',
  'Service not found': '服务不存在或已被移除。',
  'Therapist not found': '技师不存在或已被移除。',
  'Image not found': '图片不存在或已被移除。',
  'Account unavailable': '账号当前不可用，请联系公司管理员。',
  'Gallery must contain at most 20 image URLs': '相册最多支持20张图片。',
  'Expected an object': '提交内容格式无效，请检查后重试。',
  'All services must belong to this shop': '所选服务须全部属于当前门店。',
  'Payout integration is not available; no funds have been transferred': '提现通道尚未启用，本次没有转移资金。',
  'External merchant account operations are not enabled': '外部商家账号操作尚未启用。',
  'External merchant account verification is not enabled': '外部商家账号验证尚未启用。',
};
const fieldLabels: Record<string, string> = { email: '邮箱', phone: '电话', name: '名称', password: '密码', loginName: '登录账号', shopId: '门店编号', userId: '顾客编号', reason: '原因', amountCents: '金额', startDate: '开始日期', endDate: '结束日期', startTime: '开始时间', endTime: '结束时间', page: '页码', pageSize: '每页数量', description: '简介', title: '标题', address: '地址', city: '城市', state: '州', zipCode: '邮政编码', timezone: '时区', status: '状态', permissions: '权限' };
export function localizedErrorText(value: unknown, fallback = '请求未能完成，请重试。', status?: number): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const text = value.trim();
  if (/[\u3400-\u9fff]/u.test(text)) return text;
  if (knownErrors[text]) return knownErrors[text];
  if (/timeout|timed out/i.test(text)) return '请求超时，请稍后重试；提交结果不明时，请先刷新核对。';
  if (/network error|failed to fetch/i.test(text)) return knownErrors['Network Error'];
  const field = text.match(/^([A-Za-z][\w.]*)\s+(?:must|should|has to|is not)/)?.[1];
  if (field) {
    const label = fieldLabels[field] || '表单内容';
    if (/email/i.test(text)) return label + '格式不正确，请检查后重试。';
    if (/empty|required/i.test(text)) return '请填写' + label + '。';
    return label + '不符合要求，请检查后重试。';
  }
  if (status === 401) return knownErrors.Unauthorized;
  if (status === 403) return knownErrors['Forbidden resource'];
  if (status === 404) return '请求的内容不存在或已被移除，请刷新核对。';
  if (status === 409) return '记录已变化或存在冲突，请刷新核对后重试。';
  if (status === 429) return knownErrors['Too Many Requests'];
  if (status && status >= 500) return '服务器暂时无法处理请求，请稍后重试。';
  return fallback;
}
export function errorMessage(error: unknown, fallback = '请求未能完成，请重试。') {
  const value = error as { response?: { status?: number; data?: { message?: unknown; error?: { message?: unknown } } }; message?: string };
  const message = value?.response?.data?.message ?? value?.response?.data?.error?.message ?? value?.message;
  if (Array.isArray(message)) return [...new Set(message.map(item => localizedErrorText(item, fallback, value?.response?.status)))].join('；');
  return localizedErrorText(message, fallback, value?.response?.status);
}
export function money(cents: number | undefined | null, currency?: string | null) {
  return Number.isSafeInteger(cents) && currency ? `${currency.toUpperCase()} ${(cents! / 100).toFixed(2)}` : '—';
}
