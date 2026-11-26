import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
const request = require('supertest');
import { AssistedBookingController } from './assisted-booking.controller';
import { BookingService } from './booking.service';
import { RolesGuard } from '../../common/guards/roles.guard';

const secret = 'SyntheticAssistedBooking-RouteTest-NotADeployedSecret-2026';

@Injectable()
class RouteTestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret }); }
  validate(payload: { sub: string; role: string }) { return { id: payload.sub, role: payload.role }; }
}

describe('assisted booking HTTP contract', () => {
  let app: INestApplication, jwt: JwtService;
  const service = {
    assistedBookingCustomers: jest.fn(async () => [{ id: '8', email: 'verified@example.test' }]),
    assistedBookingServices: jest.fn(async () => [{ id: '2', name: 'Massage', durationMin: 60, hasVariants: false, isActive: true, variants: [] }]),
    quoteAssistedBooking: jest.fn(async () => ({ totalCents: 5000, paymentMode: 'PAY_AT_STORE' })),
    createAssistedBooking: jest.fn(async () => ({ id: '91', paymentMode: 'PAY_AT_STORE' })),
    assistedBookingTherapists: jest.fn(async () => [{ id: '7', name: 'Synthetic therapist' }]),
    getAssistedBookingSlots: jest.fn(async () => ({ date: '2035-01-01', timezone: 'UTC', durationMin: 60, slots: [{ time: '10:00', available: true }] })),
    quoteGuestAssistedBooking: jest.fn(async () => ({ totalCents: 5000, paymentMode: 'PAY_AT_STORE' })),
    createGuestAssistedBooking: jest.fn(async () => ({ outcome: 'COMMITTED', result: { bookingId: '92', bookingNo: 'MJTEST' } })),
    guestAssistedBookingOperation: jest.fn(async () => ({ outcome: 'NOT_FOUND' })),
    reconcileGuestAssistedBookingOperation: jest.fn(async () => ({ outcome: 'NOT_EXECUTED' })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [AssistedBookingController], providers: [
      RouteTestJwtStrategy, RolesGuard, { provide: BookingService, useValue: service },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app.close(); });
  const token = (role: string) => jwt.sign({ sub: '17', role });
  const auth = (role = 'MERCHANT') => ({ Authorization: `Bearer ${token(role)}` });
  const selection = { customerId: '8', serviceId: '2', date: '2035-01-01', startTime: '10:00', contact: { name: 'Reviewed customer', phone: '+12025550101', email: 'verified@example.test' } };

  it('requires an authenticated manager role and disables caching for customer lookup', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/merchant/shops/1/customers').query({ search: 'verified' })).status).toBe(401);
    const denied = await request(app.getHttpServer()).get('/api/v1/merchant/shops/1/customers').set(auth('CUSTOMER')).query({ search: 'verified' });
    expect(denied.status).toBe(403); expect(service.assistedBookingCustomers).not.toHaveBeenCalled();
    const allowed = await request(app.getHttpServer()).get('/api/v1/merchant/shops/1/customers').set(auth()).query({ search: 'verified' });
    expect(allowed.status).toBe(200); expect(allowed.headers['cache-control']).toContain('no-store');
    expect(service.assistedBookingCustomers).toHaveBeenCalledWith({ id: '17', role: 'MERCHANT' }, '1', 'verified');
  });

  it('lists only bookable services for a booking manager without exposing reservation configuration', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/merchant/shops/1/booking-services').set(auth())).status).toBe(200);
    expect(service.assistedBookingServices).toHaveBeenCalledWith({ id: '17', role: 'MERCHANT' }, '1');
    expect((await request(app.getHttpServer()).get('/api/v1/merchant/shops/1/booking-services').set(auth('CUSTOMER'))).status).toBe(403);
  });

  it('passes the route shop and authenticated operator identity to quote/create', async () => {
    const quote = await request(app.getHttpServer()).post('/api/v1/merchant/shops/1/assisted-quote').set(auth()).send(selection);
    expect(quote.status).toBe(200); expect(service.quoteAssistedBooking).toHaveBeenCalledWith({ id: '17', role: 'MERCHANT' }, { ...selection, shopId: '1' });
    const body = { ...selection, startTime: '10:00', requestKey: 'assisted-route-request-001', quoteHash: 'a'.repeat(64), quoteExpiresAt: '2035-01-01T09:59:00Z' };
    const created = await request(app.getHttpServer()).post('/api/v1/merchant/shops/1/assisted-bookings').set(auth('STAFF')).send(body);
    expect(created.status).toBe(201);
    expect(service.createAssistedBooking).toHaveBeenCalledWith({ id: '17', role: 'STAFF' }, { ...body, shopId: '1' });
  });

  it.each(['email', 'customerEmail', 'userId', 'totalCents', 'priceCents', 'paymentMode', 'tipCents', 'couponId'])('rejects caller supplied %s', async field => {
    const response = await request(app.getHttpServer()).post('/api/v1/merchant/shops/1/assisted-quote').set(auth())
      .send({ ...selection, [field]: field.toLowerCase().includes('email') ? 'forged@example.test' : '1' });
    expect(response.status).toBe(400); expect(service.quoteAssistedBooking).not.toHaveBeenCalled();
  });
  it('keeps guest commands distinct, uses authenticated shop/operator, and disables caching of contacts and receipts', async () => {
    const { customerId, ...base } = selection;
    const guest = { ...base, guestSource: 'WALK_IN', contact: { name: 'Synthetic walk-in', phone: '+12025550101' } };
    const quote = await request(app.getHttpServer()).post('/api/v1/merchant/shops/1/guest-assisted-quote').set(auth('STAFF')).send(guest);
    expect(quote.status).toBe(200); expect(quote.headers['cache-control']).toContain('no-store');
    expect(service.quoteGuestAssistedBooking).toHaveBeenCalledWith({ id: '17', role: 'STAFF' }, { ...guest, shopId: '1' });
    const key = '69ebd4c7-8059-45ab-848e-1a00bca369a9';
    const body = { ...guest, requestKey: key, quoteHash: 'a'.repeat(64), quoteExpiresAt: '2035-01-01T09:59:00.000Z' };
    const created = await request(app.getHttpServer()).post('/api/v1/merchant/shops/1/guest-assisted-bookings').set(auth()).send(body);
    expect(created.status).toBe(201); expect(created.headers['cache-control']).toContain('no-store');
    expect(service.createGuestAssistedBooking).toHaveBeenCalledWith({ id: '17', role: 'MERCHANT' }, { ...body, shopId: '1' });
    const result = await request(app.getHttpServer()).get(`/api/v1/merchant/shops/1/guest-assisted-bookings/operations/${key}`).set(auth());
    expect(result.status).toBe(200); expect(result.headers['cache-control']).toContain('no-store');
    expect(service.guestAssistedBookingOperation).toHaveBeenCalledWith({ id: '17', role: 'MERCHANT' }, '1', key);
    const fenced = await request(app.getHttpServer()).post(`/api/v1/merchant/shops/1/guest-assisted-bookings/operations/${key}/reconcile`).set(auth()).send({});
    expect(fenced.status).toBe(201); expect(fenced.headers['cache-control']).toContain('no-store');
    expect(service.reconcileGuestAssistedBookingOperation).toHaveBeenCalledWith({ id: '17', role: 'MERCHANT' }, '1', key, {});
    const therapists = await request(app.getHttpServer()).get('/api/v1/merchant/shops/1/booking-therapists').set(auth('STAFF'));
    expect(therapists.status).toBe(200); expect(therapists.headers['cache-control']).toContain('no-store');
    expect(service.assistedBookingTherapists).toHaveBeenCalledWith({ id: '17', role: 'STAFF' }, '1');
  });
  it('denies customer guest creation/lookup and rejects ownership injection before the service', async () => {
    const { customerId, ...base } = selection, guest = { ...base, guestSource: 'PHONE', contact: { name: 'Synthetic phone', phone: '+12025550101' } };
    for (const suffix of ['guest-assisted-quote', 'guest-assisted-bookings']) {
      expect((await request(app.getHttpServer()).post('/api/v1/merchant/shops/1/' + suffix).set(auth('CUSTOMER')).send(guest)).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get('/api/v1/merchant/shops/1/booking-therapists').set(auth('CUSTOMER'))).status).toBe(403);
    const lookup = '/api/v1/merchant/shops/1/guest-assisted-bookings/operations/69ebd4c7-8059-45ab-848e-1a00bca369a9';
    expect((await request(app.getHttpServer()).get(lookup).set(auth('CUSTOMER'))).status).toBe(403);
    expect((await request(app.getHttpServer()).post(lookup + '/reconcile').set(auth('CUSTOMER')).send({})).status).toBe(403);
    for (const patch of [{ customerId: '8' }, { userId: '8' }, { contact: { ...guest.contact, emailVerifiedAt: '2035-01-01' } }, { paymentMode: 'ONLINE' }, { assistedById: '9' }])
      expect((await request(app.getHttpServer()).post('/api/v1/merchant/shops/1/guest-assisted-quote').set(auth()).send({ ...guest, ...patch })).status).toBe(400);
    expect(service.quoteGuestAssistedBooking).not.toHaveBeenCalled(); expect(service.createGuestAssistedBooking).not.toHaveBeenCalled();
    expect(service.guestAssistedBookingOperation).not.toHaveBeenCalled(); expect(service.reconcileGuestAssistedBookingOperation).not.toHaveBeenCalled();
  });
  it('shares a strict internal slot endpoint for both guest and old-customer assisted bookings', async () => {
    const path = '/api/v1/merchant/shops/1/assisted-slots', selection = { serviceId: '2', date: '2035-01-01', preferredTherapistIds: '7,8' };
    const slots = await request(app.getHttpServer()).get(path).set(auth('STAFF')).query(selection);
    expect(slots.status).toBe(200); expect(slots.headers['cache-control']).toContain('no-store');
    expect(service.getAssistedBookingSlots).toHaveBeenCalledWith({ id: '17', role: 'STAFF' }, { shopId: '1', serviceId: '2', date: '2035-01-01', preferredTherapistIds: ['7', '8'] });
    expect((await request(app.getHttpServer()).get(path).query(selection)).status).toBe(401);
    expect((await request(app.getHttpServer()).get(path).set(auth('CUSTOMER')).query(selection)).status).toBe(403);
    service.getAssistedBookingSlots.mockClear();
    for (const patch of [{ shopId: '99' }, { customerId: '8' }, { contact: 'guest' }, { preferredTherapistIds: '7,7' }, { preferredTherapistIds: '7,8,9' }])
      expect((await request(app.getHttpServer()).get(path).set(auth()).query({ ...selection, ...patch })).status).toBe(400);
    expect(service.getAssistedBookingSlots).not.toHaveBeenCalled();
  });
});
