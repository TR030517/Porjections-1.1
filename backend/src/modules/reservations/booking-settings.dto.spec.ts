import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ClosedPeriodDto, ShopBookingSettingsDto } from './reservation.dto';

// Exercise the same transform/whitelist boundary as main.ts, before the service.
const pipe = () => new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});
const transform = (body: any) => pipe().transform({ expectedSettingsHash: 'a'.repeat(64), ...body }, { type: 'body', metatype: ShopBookingSettingsDto });

describe('booking settings request validation', () => {
  test.each([undefined, null, 123, 'invalid'])('rejects missing/malformed settings CAS %j', async expectedSettingsHash => {
    await expect(transform({ minimumNoticeMinutes: 0, closedPeriods: [], expectedSettingsHash })).rejects.toBeInstanceOf(BadRequestException);
  });
  test('accepts a 12-hour notice without a temporary closure', async () => {
    const body = { minimumNoticeMinutes: 720, closedPeriods: [] };
    await expect(transform(body)).resolves.toMatchObject(body);
  });

  test('accepts the merchant form payload with a 12-hour notice and a one-day closure', async () => {
    const body = { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2026-11-10', endDate: '2026-11-10' }] };
    const result = await transform(body);
    expect(result).toBeInstanceOf(ShopBookingSettingsDto);
    expect(result).toMatchObject(body);
    expect(result.closedPeriods[0]).toBeInstanceOf(ClosedPeriodDto);
  });

  test('rejects unknown nested closure fields at the request boundary', async () => {
    await expect(transform({ minimumNoticeMinutes: 720, closedPeriods: [{
      startDate: '2026-11-10', endDate: '2026-11-10', shopId: '99',
    }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  test('keeps top-level whitelist protection', async () => {
    await expect(transform({ minimumNoticeMinutes: 720, closedPeriods: [], shopId: '99' })).rejects.toBeInstanceOf(BadRequestException);
  });

  test('accepts fifty separate valid periods and rejects the fifty-first', async () => {
    const closedPeriods = Array.from({ length: 50 }, (_, index) => {
      const date = new Date(Date.UTC(2035, 0, index + 1)).toISOString().slice(0, 10);
      return { startDate: date, endDate: date };
    });
    await expect(transform({ minimumNoticeMinutes: 10080, closedPeriods })).resolves.toMatchObject({ closedPeriods });
    await expect(transform({ minimumNoticeMinutes: 10080, closedPeriods: [...closedPeriods, closedPeriods[0]] })).rejects.toBeInstanceOf(BadRequestException);
  });

  test.each([undefined, null, {}, '[]', [null], [1], [[]], [{}], [{ startDate: '2035-01-01' }]])('rejects a missing or malformed closure collection (%j)', async closedPeriods => {
    await expect(transform({ minimumNoticeMinutes: 0, closedPeriods })).rejects.toBeInstanceOf(BadRequestException);
  });

  test.each(['2035-02-29', '2036-02-30', '2035-04-31', '2035-13-01', '2035-01-00', '2035-1-01', '2035-01-01T00:00:00Z'])('rejects invalid calendar date %s in either endpoint', async date => {
    for (const row of [{ startDate: date, endDate: '2036-03-01' }, { startDate: '2035-01-01', endDate: date }]) {
      await expect(transform({ minimumNoticeMinutes: 0, closedPeriods: [row] })).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  test('accepts a real leap day without converting the local dates into instants', async () => {
    const body = { minimumNoticeMinutes: 0, closedPeriods: [{ startDate: '2036-02-29', endDate: '2036-03-01' }] };
    await expect(transform(body)).resolves.toMatchObject(body);
  });

  test.each([undefined, null, '720', true, -1, 0.5, 10081])('does not coerce an invalid advance-notice value (%j)', async minimumNoticeMinutes => {
    await expect(transform({ minimumNoticeMinutes, closedPeriods: [] })).rejects.toBeInstanceOf(BadRequestException);
  });
});
