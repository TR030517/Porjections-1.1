import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateGuestAssistedBookingDto, GuestAssistedBookingQuoteDto } from './booking.dto';

const transform = (type: any, body: unknown) => new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true,
  transformOptions: { enableImplicitConversion: true } }).transform(body, { type: 'body', metatype: type });
const input = () => ({ serviceId: '20', date: '2035-01-01', startTime: '10:00', guestSource: 'PHONE',
  contact: { name: 'Synthetic guest', phone: '+12025550101' } });
describe('guest assisted HTTP command is distinct from online and existing-customer creation', () => {
  test('requires name/phone/source but optional email never implies verification', async () => {
    for (const email of [undefined, null, '', 'unverified@example.test']) {
      await expect(transform(GuestAssistedBookingQuoteDto, { ...input(), contact: { ...input().contact, email } })).resolves.toBeInstanceOf(GuestAssistedBookingQuoteDto);
    }
    for (const field of ['name', 'phone']) {
      const contact: any = input().contact; delete contact[field];
      await expect(transform(GuestAssistedBookingQuoteDto, { ...input(), contact })).rejects.toBeInstanceOf(BadRequestException);
      for (const value of [null, 12345, true, [], {}]) await expect(transform(GuestAssistedBookingQuoteDto, { ...input(), contact: { ...input().contact, [field]: value } })).rejects.toBeInstanceOf(BadRequestException);
    }
    for (const email of [true, 12345, {}, [], 'bad email', 'a@example.test\r\nBcc:b@example.test']) await expect(transform(GuestAssistedBookingQuoteDto, { ...input(), contact: { ...input().contact, email } })).rejects.toBeInstanceOf(BadRequestException);
    for (const guestSource of [null, 1, true, 'ONLINE', 'GUEST', undefined]) await expect(transform(GuestAssistedBookingQuoteDto, { ...input(), guestSource })).rejects.toBeInstanceOf(BadRequestException);
  });
  test('rejects ownership, account, permission and payment injection', async () => {
    for (const field of ['shopId', 'userId', 'customerId', 'assistedById', 'bookingSource', 'contactVersion', 'paymentMode', 'couponId', 'tipCents', 'totalCents'])
      await expect(transform(GuestAssistedBookingQuoteDto, { ...input(), [field]: '1' })).rejects.toBeInstanceOf(BadRequestException);
    for (const field of ['verified', 'emailVerifiedAt', 'userId']) await expect(transform(GuestAssistedBookingQuoteDto, { ...input(), contact: { ...input().contact, [field]: true } })).rejects.toBeInstanceOf(BadRequestException);
  });
  test('creation requires a UUID plus quote signature and refuses original online request keys', async () => {
    const signed = { ...input(), requestKey: '69ebd4c7-8059-45ab-848e-1a00bca369a9', quoteHash: 'a'.repeat(64), quoteExpiresAt: '2035-01-01T09:59:00.000Z' };
    await expect(transform(CreateGuestAssistedBookingDto, signed)).resolves.toBeInstanceOf(CreateGuestAssistedBookingDto);
    for (const field of ['requestKey', 'quoteHash', 'quoteExpiresAt']) {
      const broken: any = { ...signed }; delete broken[field];
      await expect(transform(CreateGuestAssistedBookingDto, broken)).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(transform(CreateGuestAssistedBookingDto, { ...signed, requestKey: 'ordinary-request-key' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
