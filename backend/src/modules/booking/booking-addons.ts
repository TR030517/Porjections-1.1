import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { jwtSecret } from '../auth/security';
import { cents, numericId } from '../payment/money';

export interface AddOnSelection { participantIndex: number; sequence: number; addOnIds: string[] }
export interface AddOnTarget { participantIndex: number; sequence: number; serviceId: string }
export interface AddOnCandidate {
  sourceAddOnId: string; participantIndex: number; sequence: number; name: string;
  unitPriceCents: number; quantity: 1; lineTotalCents: number; currency: 'usd';
}
export type ResolvedAddOn = AddOnCandidate & { serviceId: string };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Request-only canonicalization, independent of mutable configuration. */
export function normalizeAddOnSelections(raw: unknown): AddOnSelection[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 12) throw new BadRequestException('Use at most twelve add-on parent selections');
  const seen = new Set<string>();
  return raw.map(row => {
    if (!object(row) || Object.keys(row).some(key => !['participantIndex', 'sequence', 'addOnIds'].includes(key))
      || !Number.isInteger(row.participantIndex) || (row.participantIndex as number) < 1 || (row.participantIndex as number) > 6
      || !Number.isInteger(row.sequence) || (row.sequence as number) < 1 || (row.sequence as number) > 4
      || !Array.isArray(row.addOnIds) || !row.addOnIds.length || row.addOnIds.length > 10) throw new BadRequestException('Invalid add-on parent selection');
    const key = row.participantIndex + ':' + row.sequence;
    if (seen.has(key)) throw new BadRequestException('Add-on parent coordinates must be unique'); seen.add(key);
    const ids = row.addOnIds.map(value => { if (typeof value !== 'string') throw new BadRequestException('Invalid add-on ID'); return numericId(value).toString(); });
    if (new Set(ids).size !== ids.length) throw new BadRequestException('An add-on can only be selected once for each main item');
    return { participantIndex: row.participantIndex as number, sequence: row.sequence as number,
      addOnIds: ids.sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1) };
  }).sort((a, b) => a.participantIndex - b.participantIndex || a.sequence - b.sequence);
}

/** Caller holds the common shop mutex; no resource or coupon writes occur here. */
export async function resolveBookingAddOns(tx: any, shopId: bigint, targets: AddOnTarget[], selections: AddOnSelection[]): Promise<ResolvedAddOn[]> {
  if (!selections.length) return [];
  const targetMap = new Map(targets.map(target => [target.participantIndex + ':' + target.sequence, target]));
  for (const row of selections) if (!targetMap.has(row.participantIndex + ':' + row.sequence)) throw new BadRequestException('An add-on needs an existing selected main item');
  const ids = [...new Set(selections.flatMap(row => row.addOnIds))];
  const configs = await tx.shopServiceAddOn.findMany({ where: { id: { in: ids.map(numericId) } }, include: { service: { select: { id: true, shopId: true, isActive: true } } } });
  const byId = new Map(configs.map((row: any) => [row.id.toString(), row]));
  const result: ResolvedAddOn[] = [];
  for (const row of selections) {
    const target = targetMap.get(row.participantIndex + ':' + row.sequence)!;
    for (const id of row.addOnIds) {
      const config: any = byId.get(id);
      if (!config || config.isActive !== true || config.service?.isActive !== true || config.service.shopId !== shopId
        || config.serviceId.toString() !== target.serviceId || config.service.id.toString() !== target.serviceId
        || config.currency !== 'usd' || !Number.isInteger(config.priceCents) || config.priceCents < 0 || config.priceCents > 10_000_000
        || typeof config.name !== 'string' || !config.name.trim() || config.name.length > 100
        || /[\u0000-\u001f\u007f]|<\/?[a-z][^>]*>/iu.test(config.name)) throw new BadRequestException('An add-on is unavailable for the selected main item');
      result.push({ sourceAddOnId: id, participantIndex: row.participantIndex, sequence: row.sequence, serviceId: target.serviceId,
        name: config.name, unitPriceCents: config.priceCents, quantity: 1, lineTotalCents: config.priceCents, currency: 'usd' });
    }
  }
  cents(result.reduce((sum, row) => sum + row.lineTotalCents, 0), 'Add-on subtotal');
  return result;
}

export function publicAddOnCandidates(rows: ResolvedAddOn[]): AddOnCandidate[] {
  return rows.map(({ serviceId: _serviceId, ...row }) => row);
}

export async function persistBookingAddOns(tx: any, bookingId: bigint, items: any[], rows: ResolvedAddOn[]) {
  if (!rows.length) return;
  const data = rows.map(row => {
    const parent = items.find(item => item.participantIndex === row.participantIndex && (item.sequence ?? 1) === row.sequence);
    if (!parent || parent.bookingId !== bookingId || parent.serviceId.toString() !== row.serviceId) throw new ConflictException('Add-on parent snapshot does not match the reservation');
    return { bookingId, bookingItemId: parent.id, sourceAddOnId: numericId(row.sourceAddOnId), participantIndex: row.participantIndex,
      sequence: row.sequence, nameSnapshot: row.name, unitPriceCentsSnapshot: row.unitPriceCents, quantity: 1,
      lineTotalCentsSnapshot: row.lineTotalCents, currency: row.currency };
  });
  await tx.bookingAddOn.createMany({ data });
}

const canonical = (value: unknown) => JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
function signature(material: unknown, quoteExpiresAt: string): string {
  return createHmac('sha256', jwtSecret()).update('massajoy:booking-addons-quote:v1\0').update(canonical({ material, quoteExpiresAt })).digest('hex');
}
export function signBookingAddOnQuote(material: unknown, now = new Date()) {
  const quoteExpiresAt = new Date(+now + 5 * 60000).toISOString();
  return { quoteHash: signature(material, quoteExpiresAt), quoteExpiresAt };
}
export function requireBookingAddOnQuote(material: unknown, quoteHash: unknown, quoteExpiresAt: unknown, now = new Date()) {
  if (typeof quoteHash !== 'string' || !/^[a-f0-9]{64}$/.test(quoteHash) || typeof quoteExpiresAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(quoteExpiresAt)
    || !Number.isFinite(Date.parse(quoteExpiresAt)) || new Date(quoteExpiresAt).toISOString() !== quoteExpiresAt
    || Date.parse(quoteExpiresAt) <= +now || Date.parse(quoteExpiresAt) > +now + 5 * 60000
    || !timingSafeEqual(Buffer.from(quoteHash, 'hex'), Buffer.from(signature(material, quoteExpiresAt), 'hex'))) {
    throw new ConflictException('The reservation quote changed or expired; request a fresh quote before submitting');
  }
}
