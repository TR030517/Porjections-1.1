import { activeReservationOptions, hasPublicReservationOptions, hasServiceVariants, serviceDisplaySource, validReservationOption } from './service-reservation-options';

const service = () => ({ isActive: true, durationKind: 'TIMED', durationMin: 15, priceCents: 0, priceBasis: 'UNKNOWN', participantCount: 1,
  variants: [{ id: 2n, isActive: true, durationMin: 60, priceCents: 13057, priceBasis: 'PER_BOOKING', currency: 'usd' }] });

describe('effective reservation options', () => {
  test('an active valid variant replaces unused base amount, duration and explicitly overridden price basis', () => {
    const row = service();
    expect(hasPublicReservationOptions(row)).toBe(true);
    expect(activeReservationOptions(row)).toEqual(row.variants);
    expect(validReservationOption(row, row)).toBe(false);
  });
  test('every configured variant counts, including disabled-only rows excluded from a public query', () => {
    const row = { ...service(), durationMin: 60, priceCents: 5000, priceBasis: 'PER_BOOKING', variants: [], _count: { variants: 1 } };
    expect(hasServiceVariants(row)).toBe(true); expect(hasPublicReservationOptions(row)).toBe(false);
    row._count.variants = 0; expect(hasPublicReservationOptions(row)).toBe(true);
  });
  test('admin metadata can display a real disabled specification without activating it or inventing a stored base', () => {
    const row=service();row.durationMin=0;row.variants[0].isActive=false;
    expect(serviceDisplaySource(row).durationMin).toBe(60);expect(row.durationMin).toBe(0);expect(hasPublicReservationOptions(row)).toBe(false);
  });
  test('variants cannot revive an inactive parent or borrow a valid kind after an explicitly invalid kind', () => {
    expect(hasPublicReservationOptions({ ...service(), isActive: false })).toBe(false);
    for (const durationKind of [null, 'UNKNOWN']) expect(hasPublicReservationOptions({ ...service(), durationKind })).toBe(false);
  });
  test.each([{ isActive: false }, { durationMin: 4 }, { durationMin: 241 }, { priceCents: 0 }, { priceCents: 1.5 }, { currency: 'eur' }, { priceBasis: 'UNKNOWN' }])('invalid selected variant never restores the base (%p)', patch => {
    const row = service(); Object.assign(row, { durationMin: 60, priceCents: 5000, priceBasis: 'PER_BOOKING' }); Object.assign(row.variants[0], patch);
    expect(hasPublicReservationOptions(row)).toBe(false);
  });
  test('new whole-order selection preserves odd package cents without multiplying legacy per-person labels', () => {
    const row = { ...service(), participantCount: 2 };
    row.variants[0].priceCents = 20001; expect(hasPublicReservationOptions(row)).toBe(true);
    row.variants[0].priceCents = 50000000; row.variants[0].priceBasis = 'PER_PERSON'; expect(hasPublicReservationOptions(row)).toBe(true);
    row.variants[0].priceBasis = 'PER_BOOKING'; expect(hasPublicReservationOptions(row)).toBe(true);
    row.variants[0].priceCents = 100000000; expect(hasPublicReservationOptions(row)).toBe(false);
  });
});

