/** Parse the entered decimal digits, rather than rounding an over-precise dollar amount. */
function couponDollarCents(value: unknown, minCents: number, maxCents: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value))) throw new Error(`${label}须为有效美元金额，最多两位小数`);
  const [whole, fraction = ''] = String(value).split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < minCents || cents > maxCents) throw new Error(`${label}须为 ${(minCents / 100).toFixed(2)}–${(maxCents / 100).toFixed(2)} 美元，最多两位小数`);
  return cents;
}
export const couponMinSpendForApi = (value: unknown): number => couponDollarCents(value, 0, 2147483647, '最低消费');
export const couponMinSpendDraft = (cents: number): number => cents / 100;

/** Claimed terms stay out of the update payload, even if a disabled draft is stale. */
export function couponEditableTerms(values: { type: 'FIXED_AMOUNT' | 'PERCENT'; value: unknown; minSpendUsd?: unknown }, termsLocked: boolean) {
  return termsLocked ? {} : { type: values.type, value: couponValueForApi(values.type, values.value), minSpendCents: couponMinSpendForApi(values.minSpendUsd ?? 0), perUserLimit: 1 };
}
/** Convert the editable coupon value to the API's integer contract. */
export function couponValueForApi(type: 'FIXED_AMOUNT' | 'PERCENT', value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('请填写优惠值');
  if (type === 'PERCENT') {
    if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('优惠比例须为 1–100 的整数');
    return value;
  }
  return couponDollarCents(value, 1, 1000000, '优惠金额');
}
