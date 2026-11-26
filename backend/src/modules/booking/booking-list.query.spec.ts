import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BookingListQueryDto } from './dto/booking-list.dto';
import { BOOKING_LIST_ORDER, bookingListResult, bookingListWhere, parseBookingListQuery } from './booking-list.query';

describe('booking list pagination and authorization filters', () => {
  test('shop recovery filter narrows the customers own list and cannot replace an authorized shop scope', () => {
    const input = { page: '1', shopId: '9007199254740993' };
    const query = parseBookingListQuery(input);
    expect(bookingListWhere(query, { userId: 17n }, 'customer')).toEqual({ AND: [
      { userId: 17n }, { deletedAt: null }, { customerHiddenAt: null }, { shopId: 9007199254740993n },
    ] });
    expect(bookingListWhere(query, { shopId: 9n }, 'merchant')).toEqual({ AND: [
      { shopId: 9n }, { deletedAt: null }, { shopId: 9007199254740993n },
    ] });
    expect(validateSync(plainToInstance(BookingListQueryDto, input), { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    for (const shopId of ['0', '-1', '01', '1.5', '1e3', ' 7', '7 ', '', '9223372036854775808', ['7', '8'], { not: '7' }, 7]) {
      expect(() => parseBookingListQuery({ shopId } as any)).toThrow(BadRequestException);
      if (shopId !== '9223372036854775808') expect(validateSync(plainToInstance(BookingListQueryDto, { shopId }), { whitelist: true, forbidNonWhitelisted: true }).length).toBeGreaterThan(0);
    }
    expect(() => parseBookingListQuery({ shopId: '7', userId: '18' } as any)).toThrow(BadRequestException);
  });
  test('history is a visible terminal-status filter and never replaces ownership, dates or soft-delete rules', () => {
    const query = parseBookingListQuery({ view: 'HISTORY', page: '2', startDate: '2026-11-01', search: 'Massage' });
    const where = bookingListWhere(query, { userId: 17n }, 'customer');
    expect(where.AND).toEqual(expect.arrayContaining([
      { userId: 17n }, { deletedAt: null }, { customerHiddenAt: null }, { status: { in: ['COMPLETED', 'CANCELLED', 'REFUNDED'] } },
      { bookingDate: { gte: new Date('2026-11-01T00:00:00Z') } },
    ]));
    expect(query).toMatchObject({ view: 'HISTORY', page: 2, paged: true });
    expect(bookingListWhere(parseBookingListQuery({ view: 'ALL' }), { userId: 17n }, 'customer'))
      .toEqual({ AND: [{ userId: 17n }, { deletedAt: null }, { customerHiddenAt: null }] });
    expect(() => parseBookingListQuery({ view: 'PAST' })).toThrow(BadRequestException);
    expect(validateSync(plainToInstance(BookingListQueryDto, { view: 'HISTORY' }))).toHaveLength(0);
    expect(validateSync(plainToInstance(BookingListQueryDto, { view: 'PAST' }))).not.toHaveLength(0);
  });
  test('legacy requests stay unpaged; either explicit page field opts into a bounded page', () => {
    expect(parseBookingListQuery({}).paged).toBe(false);
    expect(parseBookingListQuery({ status: 'CONFIRMED' }).paged).toBe(false);
    expect(parseBookingListQuery({ page: '3' })).toMatchObject({ paged: true, page: 3, pageSize: 25 });
    expect(parseBookingListQuery({ pageSize: '100' })).toMatchObject({ paged: true, page: 1, pageSize: 100 });
  });
  test('rejects invalid pagination without truncating, rounding or accepting nested query objects', () => {
    for (const query of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: '01' }, { page: '1000001' },
      { page: '9007199254740993' }, { pageSize: '101' }, { pageSize: '0' }, { pageSize: '25.0' },
      { page: ['1', '2'] }, { pageSize: { take: 100 } }, { userId: 'other-user' }, { shopId: 'other-shop' }]) {
      expect(() => parseBookingListQuery(query as any)).toThrow(BadRequestException);
    }
  });
  test('accepts genuine same-day endpoints and rejects invalid or reversed dates', () => {
    const query = parseBookingListQuery({ startDate: '2028-02-29', endDate: '2028-02-29' });
    const where = bookingListWhere(query, { userId: 17n }, 'customer');
    expect(where.AND).toContainEqual({ bookingDate: { gte: new Date('2028-02-29T00:00:00Z'), lte: new Date('2028-02-29T00:00:00Z') } });
    for (const input of [{ startDate: '2026-02-29' }, { endDate: '2026-04-31' }, { startDate: '2026-01-01T00:00:00Z' },
      { startDate: '2026-10-02', endDate: '2026-10-01' }, { startDate: '2026-13-01' }]) expect(() => parseBookingListQuery(input)).toThrow();
  });
  test('keeps customer ownership outside the search OR and searches the whole matching set', () => {
    const query = parseBookingListQuery({ page: '4', pageSize: '25', search: ' Massage ', status: 'CONFIRMED', paymentStatus: 'UNPAID', paymentMode: 'PAY_AT_STORE' });
    expect(bookingListWhere(query, { userId: 17n }, 'customer')).toEqual({ AND: [
      { userId: 17n }, { deletedAt: null }, { customerHiddenAt: null }, { status: 'CONFIRMED' }, { paymentStatus: 'UNPAID' }, { paymentMode: 'PAY_AT_STORE' },
      { OR: [{ bookingNo: { contains: 'Massage' } }, { service: { name: { contains: 'Massage' } } },
        { items: { some: { OR: [{ serviceNameSnapshot: { contains: 'Massage' } }, { variantNameSnapshot: { contains: 'Massage' } }] } } },
        { shop: { name: { contains: 'Massage' } } }] },
    ] });
  });
  test('merchant search includes guest snapshot name and phone without broadening the authorized shop predicate', () => {
    const where = bookingListWhere(parseBookingListQuery({ search: 'Guest' }), { shopId: 9n }, 'merchant');
    expect(where).toEqual({ AND: [{ shopId: 9n }, { deletedAt: null }, { OR: [
      { bookingNo: { contains: 'Guest' } }, { service: { name: { contains: 'Guest' } } },
      { items: { some: { OR: [{ serviceNameSnapshot: { contains: 'Guest' } }, { variantNameSnapshot: { contains: 'Guest' } }] } } },
      { user: { name: { contains: 'Guest' } } },
      { contactName: { contains: 'Guest' } }, { contactPhone: { contains: 'Guest' } },
    ] }] });
  });
  test('rejects unsupported state/mode, raw query arrays and excessive or control-character search', () => {
    for (const query of [{ status: 'ALL' }, { status: 'PAID' }, { paymentStatus: 'CONFIRMED' }, { paymentMode: 'CASH' },
      { search: 'x'.repeat(101) }, { search: 'x\nname' }, { search: ['name'] }, [], null]) expect(() => parseBookingListQuery(query as any)).toThrow();
    expect(parseBookingListQuery({ search: '   ' }).search).toBeUndefined();
  });
  test('total is the full filtered count rather than current-page length; ordering has a stable ID tie-break', () => {
    expect(BOOKING_LIST_ORDER).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    const query = parseBookingListQuery({ page: '21', pageSize: '25' });
    expect(bookingListResult([{ id: 'last-page-item' }], 501, query)).toEqual({ items: [{ id: 'last-page-item' }], total: 501, page: 21, pageSize: 25, totalPages: 21 });
    expect(bookingListResult([], 0, parseBookingListQuery({ page: '1' })).totalPages).toBe(0);
  });
  test('HTTP DTO accepts the explicit contract and rejects repeated fields or operator injection', () => {
    const check = (input: object) => validateSync(plainToInstance(BookingListQueryDto, input), { whitelist: true, forbidNonWhitelisted: true });
    expect(check({ page: '2', pageSize: '50', status: 'CONFIRMED', paymentMode: 'ZERO', search: 'Booking', startDate: '2026-10-28' })).toHaveLength(0);
    expect(check({ page: ['1', '2'] }).length).toBeGreaterThan(0);
    expect(check({ status: { not: 'CANCELLED' } }).length).toBeGreaterThan(0);
    expect(check({ userId: 'another-user' }).length).toBeGreaterThan(0);
  });
});
