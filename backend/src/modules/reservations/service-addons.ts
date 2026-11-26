import { BadRequestException } from '@nestjs/common';
export const SERVICE_ADDON_FIELDS = ['name','description','priceCents','currency','isActive','sortOrder'] as const;
function plain(value: unknown, max: number, required = false): string | null {
  if (value === null || value === undefined) { if (!required) return null; throw new BadRequestException('请填写附加项目名称'); }
  if (typeof value !== 'string' || value.length > max || /<\/?[a-z][^>]*>/iu.test(value)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || required && /[\r\n\t]/u.test(value)) throw new BadRequestException('附加项目须使用有效纯文本');
  const text=value.replace(/\r\n?/g,'\n').trim();
  if (required&&!text) throw new BadRequestException('请填写附加项目名称');
  return text||null;
}
export function serviceAddOnInput(raw: Record<string, unknown>) {
  if (typeof raw.priceCents!=='number'||!Number.isInteger(raw.priceCents)||raw.priceCents<0||raw.priceCents>10000000) throw new BadRequestException('附加价格须为0至10000000的整数美分');
  if (raw.currency!=='usd'||typeof raw.isActive!=='boolean'||typeof raw.sortOrder!=='number'||!Number.isInteger(raw.sortOrder)||raw.sortOrder<0||raw.sortOrder>10000) throw new BadRequestException('请核对附加项目币种、启用状态和排序');
  return {name:plain(raw.name,100,true)!,description:plain(raw.description,1000),priceCents:raw.priceCents,currency:'usd',isActive:raw.isActive,sortOrder:raw.sortOrder};
}
