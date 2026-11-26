import { BadRequestException } from '@nestjs/common';
export function cents(value: number, name = 'Amount') {
  if (!Number.isSafeInteger(value) || value < 0 || value > 99999999) throw new BadRequestException(`${name} must be non-negative integer cents`);
  return value;
}
export function quoteCents(price: number, discount: number, fee: number, tip = 0) {
  cents(price); cents(discount); cents(fee); cents(tip);
  if (discount > price) throw new BadRequestException('Discount exceeds subtotal');
  return { subtotalCents: price, discountCents: discount, platformFeeCents: fee, ...(tip ? { tipCents: tip } : {}), totalCents: cents(price - discount + fee + tip), currency: 'usd' };
}
export function feeCents(net: number) {
  const bps = Number(process.env.PLATFORM_FEE_BPS || '0');
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('PLATFORM_FEE_BPS must be between 0 and 10000');
  return Math.round(cents(net) * bps / 10000);
}
export function numericId(id: string) {
  if (!/^[1-9]\d{0,18}$/.test(id || '')) throw new BadRequestException('Invalid resource ID');
  if (BigInt(id) > 9223372036854775807n) throw new BadRequestException('Invalid resource ID');
  return BigInt(id);
}
