import { BadRequestException, ConflictException } from '@nestjs/common';
import { applyMenuCopyPlan, planMenuCopy } from './menu-copy-plan';

const parent = (id: bigint, shopId = 10n, patch: any = {}) => ({ id, shopId, name: 'Couples Massage', nameEn: null, category: 'MASSAGE', durationKind: 'TIMED', durationMin: 60, priceCents: 16000,
  priceBasis: 'PER_BOOKING', participantCount: 2, requiredStaffCount: 2, requiredRoomType: null, staffBufferMin: 10, roomBufferMin: 0, description: null, sortOrder: 0, isActive: true, variants: [], addOns: [], ...patch });
const variant = (id: bigint, serviceId: bigint, patch: any = {}) => ({ id, serviceId, name: '90 minutes', durationMin: 90, priceCents: 22000, priceBasis: 'PER_BOOKING', currency: 'usd', sortOrder: 0, isActive: true, ...patch });
const addon = (id: bigint, serviceId: bigint, patch: any = {}) => ({ id, serviceId, name: 'Essential Oil', description: null, priceCents: 1000, currency: 'usd', sortOrder: 0, isActive: true, ...patch });
const menu = (booking: any, patch: any = {}) => [{ category: 'Massage', items: [{ name: 'Old text', priceText: '$1', booking, ...patch }] }];
function writer() {
  const writes: any[] = [], models = Object.fromEntries(['shopService', 'shopServiceVariant', 'shopServiceAddOn'].map((model, i) => [model, {
    create: async ({ data }: any) => { const row = { id: BigInt(300 + writes.length + i), ...data }; writes.push({ model, row }); return row; },
  }]));
  return { tx: models, writes };
}

describe('one canonical project/menu copy plan', () => {
  test.each([{ participantCount: 2, requiredStaffCount: 2 }, { participantCount: 1, requiredStaffCount: 2 }])('copies a double-therapist option with target IDs and keeps it paused: %j', async mode => {
    const source = parent(100n, 10n, { ...mode, variants: [variant(101n, 100n)] }), before = structuredClone(source);
    const plan = planMenuCopy(menu({ serviceId: '100', variantId: '101' }), [source], [], 10n, 11n);
    expect(plan.links).toMatchObject([{ resource: 'SERVICE', sourceId: '100', targetId: null, action: 'CREATE' }, { resource: 'VARIANT', sourceId: '101', targetId: null, action: 'CREATE' }]);
    const { tx, writes } = writer(), saved = await applyMenuCopyPlan(tx, 11n, plan), item = saved[0].items[0];
    expect(writes).toHaveLength(2); expect(writes.every(write => write.row.isActive === false)).toBe(true);
    expect(writes[0].row).toMatchObject({ shopId: 11n, ...mode, staffBufferMin: 10 });
    expect(item.booking).toEqual({ serviceId: String(writes[0].row.id), variantId: String(writes[1].row.id) });
    expect(item.bookingEnabled).toBe(false); expect(item.pricing?.priceCents).toBe(22000); expect(item.reservedDurationMin).toBe(90);
    expect(source).toEqual(before);
  });
  test('reuses exact target IDs and target activation, and a fresh copy never duplicates resources', async () => {
    const source = parent(100n, 10n, { variants: [variant(101n, 100n)], addOns: [addon(102n, 100n)] });
    const target = parent(200n, 11n, { isActive: false, variants: [variant(201n, 200n, { isActive: false })], addOns: [addon(202n, 200n, { isActive: false })] });
    const raw = [{ category: 'Massage', items: [...menu({ serviceId: '100', variantId: '101' })[0].items, ...menu({ serviceId: '100', addOnId: '102' })[0].items] }];
    const plan = planMenuCopy(raw, [source], [target], 10n, 11n), { tx, writes } = writer();
    expect(plan.links.map(row => row.action)).toEqual(['REUSE', 'REUSE', 'REUSE']);
    const saved = await applyMenuCopyPlan(tx, 11n, plan); expect(writes).toEqual([]);
    expect(saved[0].items.map(row => row.booking)).toEqual([{ serviceId: '200', variantId: '201' }, { serviceId: '200', addOnId: '202' }]);
    expect(saved[0].items.every(row => row.bookingEnabled === false)).toBe(true);
    target.isActive = true; target.variants[0].isActive = true;
    const active = await applyMenuCopyPlan(tx, 11n, planMenuCopy(raw, [source], [target], 10n, 11n));
    expect(active[0].items[0].bookingEnabled).toBe(true); expect(active[0].items[1].bookingEnabled).toBe(false);
  });
  test('only linked add-ons copy, with new child and parent IDs and no independent duration', async () => {
    const source = parent(100n, 10n, { addOns: [addon(102n, 100n), addon(103n, 100n, { name: 'Unlisted' })] });
    const plan = planMenuCopy(menu({ serviceId: '100', addOnId: '102' }), [source], [], 10n, 11n), { tx, writes } = writer();
    const saved = await applyMenuCopyPlan(tx, 11n, plan);
    expect(writes.map(row => row.model)).toEqual(['shopService', 'shopServiceAddOn']);
    expect(saved[0].items[0].booking).toEqual({ serviceId: String(writes[0].row.id), addOnId: String(writes[1].row.id) });
    expect(saved[0].items[0].pricing?.kind).toBe('ADD_ON'); expect(saved[0].items[0].reservedDurationMin).toBeUndefined();
    expect(writes[1].row.durationMin).toBeUndefined(); expect(writes[1].row.isActive).toBe(false);
  });
  test('adds a missing inactive variant to an exact existing variant-based parent without changing existing variants', async () => {
    const source = parent(100n, 10n, { variants: [variant(101n, 100n)] });
    const target = parent(200n, 11n, { variants: [variant(201n, 200n, { name: '60 minutes', durationMin: 60, priceCents: 16000 })] }), before = structuredClone(target);
    const { tx, writes } = writer(), saved = await applyMenuCopyPlan(tx, 11n, planMenuCopy(menu({ serviceId: '100', variantId: '101' }), [source], [target], 10n, 11n));
    expect(writes.map(row => row.model)).toEqual(['shopServiceVariant']); expect(writes[0].row).toMatchObject({ serviceId: 200n, isActive: false });
    expect(saved[0].items[0].booking?.serviceId).toBe('200'); expect(saved[0].items[0].bookingEnabled).toBe(false); expect(target).toEqual(before);
  });
  test('rejects dangling/cross-shop/pending/direct-parent variant links rather than removing them', () => {
    for (const raw of [menu({ serviceId: '999' }), menu({ serviceId: '100', variantId: '999' }), [{ category: '', items: [{ name: 'Draft', priceText: '', newVariantOf: '100' }] }], menu({ serviceId: '100' })]) {
      expect(() => planMenuCopy(raw, [parent(100n, 10n, { variants: [variant(101n, 100n)] })], [], 10n, 11n)).toThrow(ConflictException);
    }
    expect(() => planMenuCopy(menu({ serviceId: '100' }), [parent(100n, 12n)], [], 10n, 11n)).toThrow(ConflictException);
  });
  test('rejects target price/policy/shape or duplicate-name conflicts and unsupported new currencies', () => {
    for (const patch of [{ priceCents: 15000 }, { requiredStaffCount: 1 }, { variants: [variant(201n, 200n)] }]) {
      expect(() => planMenuCopy(menu({ serviceId: '100' }), [parent(100n)], [parent(200n, 11n, patch)], 10n, 11n)).toThrow(ConflictException);
    }
    expect(() => planMenuCopy(menu({ serviceId: '100' }), [parent(100n)], [parent(200n, 11n), parent(201n, 11n)], 10n, 11n)).toThrow(ConflictException);
    const source = parent(100n, 10n, { variants: [variant(101n, 100n, { currency: 'eur' })] });
    expect(() => planMenuCopy(menu({ serviceId: '100', variantId: '101' }), [source], [], 10n, 11n)).toThrow(BadRequestException);
  });
  test('keeps display-only entries unlinked and has no writes for an empty or display-only menu', async () => {
    for (const raw of [[], [{ category: 'Display', items: [{ name: 'Call us', priceText: 'Call for price', imageUrl: 'https://example.test/menu.jpg' }] }]]) {
      const plan = planMenuCopy(raw, [], [], 10n, 11n), { tx, writes } = writer();
      expect(plan.links).toEqual([]); expect(await applyMenuCopyPlan(tx, 11n, plan)).toEqual(raw); expect(writes).toEqual([]);
    }
  });
});
