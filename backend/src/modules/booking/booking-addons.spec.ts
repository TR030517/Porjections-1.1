import 'reflect-metadata';
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { BookingAddOnSelectionDto, CreateBookingDto, QuoteBookingDto, QuotePlanDto } from './dto/booking.dto';
import { normalizeAddOnSelections, resolveBookingAddOns, persistBookingAddOns, signBookingAddOnQuote, requireBookingAddOnQuote } from './booking-addons';
import { bookingAddOnsView } from '../../common/booking-addons-view';

const selection = () => [{ participantIndex: 1, sequence: 1, addOnIds: ['2'] }];
const config = () => ({ id: 2n, serviceId: 20n, name: 'Essential Oil', priceCents: 1000, currency: 'usd', isActive: true, service: { id: 20n, shopId: 10n, isActive: true } });
const target = () => [{ participantIndex: 1, sequence: 1, serviceId: '20' }];

describe('bounded primary-item add-on selection and snapshots', () => {
  test('normalizes only IDs/coordinates and preserves explicit participant attachment without implied multiplication', () => {
    expect(normalizeAddOnSelections(undefined)).toEqual([]); expect(normalizeAddOnSelections([])).toEqual([]);
    expect(normalizeAddOnSelections([{ participantIndex: 2, sequence: 1, addOnIds: ['12', '2'] }, ...selection()])).toEqual([
      ...selection(), { participantIndex: 2, sequence: 1, addOnIds: ['2', '12'] },
    ]);
  });
  test('rejects duplicate parents/IDs, unknown monetary fields, coercion, empty parent selections and unbounded requests', () => {
    const row = selection()[0];
    for (const raw of [null, {}, [null], [{ ...row, quantity: 2 }], [{ ...row, priceCents: 1 }], [{ ...row, participantIndex: '1' }], [{ ...row, sequence: 0 }],
      [{ ...row, participantIndex: 7 }], [{ ...row, addOnIds: [] }], [{ ...row, addOnIds: ['2', '2'] }], [{ ...row, addOnIds: [2] }],
      [{ ...row, addOnIds: ['9223372036854775808'] }], [{ ...row, addOnIds: Array.from({ length: 11 }, (_, i) => String(i + 1)) }],
      [row, row], Array.from({ length: 13 }, () => row)]) expect(() => normalizeAddOnSelections(raw)).toThrow(BadRequestException);
  });
  test('actual implicit-conversion DTO validates nested coordinates/IDs without accepting quoted numbers or hidden price/quantity', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
    const transform = (value: unknown) => pipe.transform(value, { type: 'body', metatype: BookingAddOnSelectionDto });
    expect(await transform(selection()[0])).toEqual(selection()[0]);
    for (const input of [{ ...selection()[0], participantIndex: '1' }, { ...selection()[0], sequence: '1' }, { ...selection()[0], addOnIds: [2] }, { ...selection()[0], quantity: 1 }]) await expect(transform(input)).rejects.toThrow();
    const body = { shopId: '10', serviceId: '20', date: '2035-01-01', startTime: '09:00', addOnSelections: selection() };
    expect((await pipe.transform(body, { type: 'body', metatype: QuoteBookingDto })).addOnSelections).toHaveLength(1);
    expect((await pipe.transform({ shopId: '10', date: '2035-01-01', startTime: '09:00', items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }], addOnSelections: selection() }, { type: 'body', metatype: QuotePlanDto })).items).toHaveLength(1);
    for (const addOnSelections of [null, [{ ...selection()[0], participantIndex: '1' }]]) await expect(pipe.transform({ ...body, contact: { name: 'Synthetic customer', phone: '+12025550100', email: 'synthetic.addon@example.test' }, addOnSelections }, { type: 'body', metatype: CreateBookingDto })).rejects.toThrow();
  });
  test('resolves only active same-shop/same-main-service configuration with bounded USD cents', async () => {
    const findMany = jest.fn(async () => [config()]), tx = { shopServiceAddOn: { findMany } };
    expect(await resolveBookingAddOns(tx, 10n, target(), selection())).toEqual([{ sourceAddOnId: '2', participantIndex: 1, sequence: 1, serviceId: '20', name: 'Essential Oil', unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, currency: 'usd' }]);
    for (const changes of [{ isActive: false }, { currency: 'eur' }, { priceCents: -1 }, { priceCents: 10_000_001 }, { priceCents: 1.5 }, { name: '<b>Oil</b>' }, { serviceId: 21n }, { service: { id: 20n, shopId: 11n, isActive: true } }, { service: { id: 20n, shopId: 10n, isActive: false } }]) {
      findMany.mockResolvedValueOnce([{ ...config(), ...changes }]);
      await expect(resolveBookingAddOns(tx, 10n, target(), selection())).rejects.toThrow(BadRequestException);
    }
    await expect(resolveBookingAddOns(tx, 10n, [], selection())).rejects.toThrow(BadRequestException);
    const unused = jest.fn(); expect(await resolveBookingAddOns({ shopServiceAddOn: { findMany: unused } }, 10n, target(), [])).toEqual([]); expect(unused).not.toHaveBeenCalled();
  });
  test('snapshot writer verifies primary booking/service/coordinates before creating any rows', async () => {
    const tx = { bookingAddOn: { createMany: jest.fn() } }, rows = await resolveBookingAddOns({ shopServiceAddOn: { findMany: async () => [config()] } }, 10n, target(), selection());
    const parent = { id: 30n, bookingId: 40n, serviceId: 20n, participantIndex: 1, sequence: 1 };
    await persistBookingAddOns(tx, 40n, [parent], rows);
    expect(tx.bookingAddOn.createMany).toHaveBeenCalledWith({ data: [{ bookingId: 40n, bookingItemId: 30n, sourceAddOnId: 2n, participantIndex: 1, sequence: 1, nameSnapshot: 'Essential Oil', unitPriceCentsSnapshot: 1000, quantity: 1, lineTotalCentsSnapshot: 1000, currency: 'usd' }] });
    for (const wrong of [{ ...parent, bookingId: 41n }, { ...parent, serviceId: 21n }, { ...parent, participantIndex: 2 }]) await expect(persistBookingAddOns(tx, 40n, [wrong], rows)).rejects.toThrow(ConflictException);
    expect(tx.bookingAddOn.createMany).toHaveBeenCalledTimes(1);
  });
  test('HMAC quote binds material/identity/expiry, rejects tampering and expires exactly after five minutes', () => {
    const now = new Date('2035-01-01T00:00:00.000Z'), material = { userId: '7', selection: selection(), totalCents: 6000, name: 'Essential Oil' };
    const q = signBookingAddOnQuote(material, now);
    expect(q.quoteExpiresAt).toBe('2035-01-01T00:05:00.000Z');
    expect(() => requireBookingAddOnQuote(material, q.quoteHash, q.quoteExpiresAt, new Date(+now + 1))).not.toThrow();
    for (const changed of [{ ...material, userId: '8' }, { ...material, totalCents: 6001 }, { ...material, name: 'Different' }, { ...material, selection: [] }]) expect(() => requireBookingAddOnQuote(changed, q.quoteHash, q.quoteExpiresAt, now)).toThrow(ConflictException);
    for (const [hash, expires, at] of [[q.quoteHash, q.quoteExpiresAt, new Date(+now + 300000)], [q.quoteHash, '2035-01-01T00:06:00.000Z', now], ['a'.repeat(64), q.quoteExpiresAt, now], [q.quoteHash, 'invalid', now]] as const) expect(() => requireBookingAddOnQuote(material, hash, expires, at)).toThrow(ConflictException);
  });
  test('immutable views separate main subtotal, fail closed on corrupt snapshot/parent totals and project no configuration fields', () => {
    const row = { id: 1n, bookingId: 40n, bookingItemId: 30n, sourceAddOnId: 2n, participantIndex: 1, sequence: 1, nameSnapshot: 'Original Oil', unitPriceCentsSnapshot: 1000, lineTotalCentsSnapshot: 1000, quantity: 1, currency: 'usd', privateField: 'PRIVATE' };
    const booking = { id: 40n, priceCents: 6000, addOns: [row], items: [{ id: 30n, bookingId: 40n, participantIndex: 1, sequence: 1, priceCentsSnapshot: 5000 }] };
    const view = bookingAddOnsView(booking); expect(view.mainSubtotalCents).toBe(5000); expect(view.addOnSubtotalCents).toBe(1000); expect(view.addOns[0].name).toBe('Original Oil');
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE|Snapshot|privateField/);
    expect(bookingAddOnsView({ priceCents: 5000 })).toEqual({ mainSubtotalCents: 5000, addOnSubtotalCents: 0, addOns: [] });
    for (const patch of [{ bookingId: 41n }, { quantity: 2 }, { lineTotalCentsSnapshot: 2000 }, { currency: 'eur' }, { participantIndex: 2 }]) expect(() => bookingAddOnsView({ ...booking, addOns: [{ ...row, ...patch }] })).toThrow(ConflictException);
    expect(() => bookingAddOnsView({ ...booking, addOns: [row, row] })).toThrow(ConflictException);
    expect(() => bookingAddOnsView({ ...booking, priceCents: 6001 })).toThrow(ConflictException);
  });
});
