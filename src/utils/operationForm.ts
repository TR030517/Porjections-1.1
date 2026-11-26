import { readServiceDurationKind } from './serviceDuration';
import type { OperationField } from '../config/operations';
import { passwordPolicyError } from '../../backend/src/common/password-policy';

// Native minlength counts UTF-16 code units, which would reject valid UTF-8
// passwords such as four common Chinese characters (12 bytes).
export function operationFieldMinLength(field: OperationField): number | undefined {
  return field.type === 'password' ? undefined : field.minLength;
}

export function visibleOperationFields(fields: OperationField[], editing: boolean) {
  return fields.filter(field => !(editing && field.createOnly) && !(!editing && field.editOnly));
}

export function localPublicationInput(value: unknown) {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  if (!Number.isFinite(+date)) return '';
  return new Date(+date-date.getTimezoneOffset()*60000).toISOString().slice(0,19);
}

export function publicationInputInstant(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value)) throw new Error('请填写完整的发布时间。');
  const date = new Date(value);
  const expected=value.length===16?value+':00':value;
  if (!Number.isFinite(+date) || localPublicationInput(date.toISOString())!==expected) throw new Error('该本地时间不存在，请选择有效的发布时间。');
  for (const delta of [-120,-90,-60,-30,30,60,90,120]) {
    if (localPublicationInput(new Date(+date+delta*60000).toISOString())===expected) throw new Error('该本地时间在夏令时切换时重复，请选择其他发布时间。');
  }
  return date.toISOString();
}

export function buildOperationPayload(fields: OperationField[], form: Record<string, unknown>, editing: boolean) {
  const payload: Record<string, unknown> = {};
  for (const field of visibleOperationFields(fields, editing)) {
    if (field.readOnly || editing && field.immutable) continue;
    const raw = form[field.key];
    const value = typeof raw === 'string' && field.type !== 'password' ? raw.trim() : raw;
    if ((field.required || !editing && field.requiredOnCreate) && (value == null || value === '')) throw new Error('请填写' + field.label);
    if (field.type === 'email' && typeof value === 'string' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(field.label + '格式不正确。');
    if (field.type === 'password') {
      const role = field.passwordRole ?? (field.minLength === 6 ? 'MERCHANT' : 'ADMIN');
      const policyError = passwordPolicyError(value, role);
      if (policyError) throw new Error(policyError);
      if (role === 'MERCHANT' && (value as string) !== (value as string).trim()) throw new Error('密码首尾不能含空白字符。');
    }
    if (typeof value === 'string' && field.maxLength && value.length > field.maxLength) throw new Error(field.label + '超出允许长度。');
    if (typeof value === 'string' && value && field.pattern && !new RegExp('^(?:' + field.pattern + ')$').test(value)) throw new Error(field.label + '格式不正确。' + (field.hint ?? ''));
    if (field.type === 'datetime-local') {
      if (value === '' || value === undefined || value === null) {
        if (field.key === 'endAt') payload[field.key] = null;
      } else payload[field.key] = publicationInputInstant(value);
    } else if (field.type === 'number') {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || field.min !== undefined && number < field.min || field.max !== undefined && number > field.max) throw new Error(field.label + '必须为允许范围内的整数。');
      payload[field.key] = number;
    } else payload[field.key] = field.key === 'durationKind' ? readServiceDurationKind(value) : value;
  }
  if (typeof payload.startAt === 'string' && typeof payload.endAt === 'string' && Date.parse(payload.endAt) <= Date.parse(payload.startAt)) throw new Error('结束时间必须晚于开始时间。');
  return payload;
}
