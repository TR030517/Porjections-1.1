import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AssistedBookingQuoteDto, CreateAssistedBookingDto, CreateBookingDto, CreatePlanDto, QuoteBookingDto, QuotePlanDto } from './booking.dto';

// Exercise the exact global transformation/whitelist contract, including
// primitive coercion that nested contacts must explicitly avoid.
const transform = (metatype: any, body: unknown) => new ValidationPipe({
  whitelist: true, forbidNonWhitelisted: true, transform: true,
  transformOptions: { enableImplicitConversion: true },
}).transform(body, { type: 'body', metatype });
const contact = () => ({ name: ' Zoë 李明 ', phone: '+44 (20) 7946-0958', email: 'contact@example.test' });
const single = () => ({ shopId: '10', serviceId: '20', date: '2030-06-01', startTime: '10:00', requestKey: 'synthetic-contact-single' });
const plan = () => ({ shopId: '10', date: '2030-06-01', startTime: '10:00', requestKey: 'synthetic-contact-plan', items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }] });

describe.each([
  ['STANDARD', CreateBookingDto, single], ['PLAN', CreatePlanDto, plan],
])('%s online creation contact DTO', (_name, type, base) => {
  test('requires an explicitly supplied contact object', async () => {
    await expect(transform(type, base())).rejects.toBeInstanceOf(BadRequestException);
    for (const value of [null, [], [contact()], '', 'contact', 42, true]) await expect(transform(type, { ...base(), contact: value })).rejects.toBeInstanceOf(BadRequestException);
  });
  test('accepts a valid complete contact without rewriting the command before domain normalization', async () => {
    const result = await transform(type, { ...base(), contact: contact() });
    expect(result.contact).toEqual(contact()); expect(result).toBeInstanceOf(type);
  });
  test('accepts 100 supplementary-plane name characters at the HTTP validation boundary', async () => {
    const name = '\u{20bb7}'.repeat(100);
    expect(name.length).toBe(200);
    const result = await transform(type, { ...base(), contact: { ...contact(), name } });
    expect(result.contact.name).toBe(name);
    expect(result).toBeInstanceOf(type);
  });
  test('rejects 101 supplementary-plane name characters at the HTTP validation boundary', async () => {
    await expect(transform(type, { ...base(), contact: { ...contact(), name: '\u{20bb7}'.repeat(101) } })).rejects.toBeInstanceOf(BadRequestException);
  });
  test.each(['\ud800', '\udfff'])('rejects unpaired surrogate name characters before HTTP domain entry %j', async name => {
    await expect(transform(type, { ...base(), contact: { ...contact(), name } })).rejects.toBeInstanceOf(BadRequestException);
  });
  test.each(['name', 'phone', 'email'])('requires contact.%s and refuses implicit primitive conversion', async field => {
    const missing: any = contact(); delete missing[field]; await expect(transform(type, { ...base(), contact: missing })).rejects.toBeInstanceOf(BadRequestException);
    for (const value of [null, 12345678, true, [], {}]) await expect(transform(type, { ...base(), contact: { ...contact(), [field]: value } })).rejects.toBeInstanceOf(BadRequestException);
  });
  test.each([
    { name: 'Name\n' }, { name: ' '.repeat(8) }, { name: 'x'.repeat(101) },
    { phone: '2025550123' }, { phone: '+01234567' }, { phone: '+123456' },
    { email: 'unverified syntax' }, { email: 'a@example.test\r\nBcc:another@example.test' },
  ])('rejects invalid contact fields at the request boundary %j', async patch => {
    await expect(transform(type, { ...base(), contact: { ...contact(), ...patch } })).rejects.toBeInstanceOf(BadRequestException);
  });
  test('rejects client-supplied contact authority and extra top-level fields', async () => {
    await expect(transform(type, { ...base(), contact: { ...contact(), verified: true } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(transform(type, { ...base(), contact: contact(), contactVersion: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe.each([
  ['STANDARD quote', QuoteBookingDto, () => { const { requestKey, ...input } = single(); return input; }],
  ['PLAN quote', QuotePlanDto, () => { const { requestKey, ...input } = plan(); return input; }],
])('%s excludes non-price contact data', (_name, type, base) => {
  test('does not require a contact in the pricing contract', async () => { await expect(transform(type, base())).resolves.toBeInstanceOf(type); });
  test('forbids accidentally submitting contact as quote material', async () => { await expect(transform(type, { ...base(), contact: contact() })).rejects.toBeInstanceOf(BadRequestException); });
});

describe('existing verified-customer merchant assisted contact DTO', () => {
  const assisted = () => { const { shopId, ...input } = single(); return { ...input, customerId: '5' }; };
  test('accepts explicit contacts and legacy replay-only bodies without accepting authority or primitive conversion', async () => {
    await expect(transform(CreateAssistedBookingDto, assisted())).resolves.toBeInstanceOf(CreateAssistedBookingDto);
    for (const field of ['customerId', 'requestKey']) { const input: any = assisted(); delete input[field]; await expect(transform(CreateAssistedBookingDto, input)).rejects.toBeInstanceOf(BadRequestException); }
    await expect(transform(CreateAssistedBookingDto, { ...assisted(), contact: contact() })).resolves.toBeInstanceOf(CreateAssistedBookingDto);
    for (const patch of [null, { ...contact(), phone: 12345678 }, { ...contact(), verified: true }]) await expect(transform(CreateAssistedBookingDto, { ...assisted(), contact: patch })).rejects.toBeInstanceOf(BadRequestException);
  });
  test('requires a reviewed quote contact and forbids identity/payment overrides', async () => {
    const { requestKey, ...input } = assisted(); await expect(transform(AssistedBookingQuoteDto, { ...input, contact: contact() })).resolves.toBeInstanceOf(AssistedBookingQuoteDto);
    await expect(transform(AssistedBookingQuoteDto, input)).rejects.toBeInstanceOf(BadRequestException);
    for (const patch of [{ shopId: '99' }, { paymentMode: 'ONLINE' }, { tipCents: 100 }, { contact: { ...contact(), email: true } }]) await expect(transform(AssistedBookingQuoteDto, { ...input, contact: contact(), ...patch })).rejects.toBeInstanceOf(BadRequestException);
  });
});
