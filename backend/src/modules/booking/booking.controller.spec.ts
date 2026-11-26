/** Real Nest HTTP/Passport signature and route-guard contract, with business services isolated.
 * Durable real AuthSession/MySQL checks are performed by the separate three-end HTTP runner. */
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
const request = require('supertest');
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { SettlementService } from './settlement.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

const secret = 'SyntheticThreeEndRouteTest-NotADeployedSecret-2026';
@Injectable()
class RouteTestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret }); }
  validate(payload: { sub: string; role: string }) { return { id: payload.sub, role: payload.role }; }
}

describe('Booking HTTP public-preview and authenticated creation contract', () => {
  let app: INestApplication, jwt: JwtService;
  const service = {
    getAvailableSlots: jest.fn(async () => ({ priceCents: 3500, durationMin: 30, slots: [{ time: '10:00', available: true }] })),
    getPlanSlots: jest.fn(async () => ({ priceCents: 3500, slots: [{ time: '10:00', available: true }] })),
    createBooking: jest.fn(async () => ({ id: '81', status: 'PENDING' })),
    createPlan: jest.fn(async () => ({ id: '82', status: 'PENDING' })),
    getBooking: jest.fn(async () => ({ id: '81' })),
    getRescheduleSlots: jest.fn(async () => ({ slots: [] })),
    updateBookingStatus: jest.fn(async () => ({ id: '81', status: 'CANCELLED' })),
    cancelBooking: jest.fn(async () => ({ id: '81', status: 'CANCELLED' })),
  };
  const contact = { name: 'Synthetic customer', phone: '+12025550100', email: 'synthetic.route@example.test' };
  const single = { contact, shopId: '1', serviceId: '2', variantId: '3', date: '2026-11-02', startTime: '10:00', paymentMode: 'PAY_AT_STORE', requestKey: 'three-end-single-key' };
  const plan = { shopId: '1', date: '2026-11-02', items: [{ participantIndex: 1, sequence: 1, serviceId: '2', variantId: '3' }] };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [BookingController], providers: [
      RouteTestJwtStrategy, JwtAuthGuard, RolesGuard, { provide: BookingService, useValue: service }, { provide: SettlementService, useValue: {} },
    ] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => { jest.clearAllMocks(); });
  afterAll(async () => { await app.close(); });
  const token = (role: string) => jwt.sign({ sub: '17', role });

  it('anonymous guests can fetch a selected service quote and available times without a JWT', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/bookings/slots').query({ shopId: '1', serviceId: '2', variantId: '3', date: '2026-11-02' });
    expect(response.status).toBe(200); expect(response.body.slots[0].available).toBe(true);
    expect(service.getAvailableSlots).toHaveBeenCalledWith(expect.objectContaining({ shopId: '1', serviceId: '2', variantId: '3' }));
  });
  it('anonymous guests can preview a multi-item plan but receive no private booking record', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/bookings/plan-slots').send(plan);
    expect(response.status).toBe(201); expect(response.body.priceCents).toBe(3500); expect(response.body.id).toBeUndefined();
    expect(service.getPlanSlots).toHaveBeenCalledWith(plan); expect(service.createPlan).not.toHaveBeenCalled();
  });
  it('anonymous creation and existing-order reads/reschedule previews remain 401', async () => {
    expect((await request(app.getHttpServer()).post('/api/v1/bookings').send(single)).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/v1/bookings/plan').send({ ...plan, startTime: '10:00', requestKey: 'three-end-plan-key' })).status).toBe(401);
    for (const route of ['/api/v1/bookings/81', '/api/v1/bookings/81/reschedule-slots?date=2026-11-02']) expect((await request(app.getHttpServer()).get(route)).status).toBe(401);
    expect(service.createBooking).not.toHaveBeenCalled(); expect(service.createPlan).not.toHaveBeenCalled(); expect(service.getBooking).not.toHaveBeenCalled();
  });
  it('real signed MERCHANT, STAFF and ADMIN tokens cannot create customer reservations', async () => {
    for (const role of ['MERCHANT', 'STAFF', 'ADMIN']) {
      const auth = 'Bearer ' + token(role);
      expect((await request(app.getHttpServer()).post('/api/v1/bookings').set('Authorization', auth).send(single)).status).toBe(403);
      expect((await request(app.getHttpServer()).post('/api/v1/bookings/plan').set('Authorization', auth).send({ ...plan, startTime: '10:00', requestKey: 'three-end-plan-key' })).status).toBe(403);
    }
    expect(service.createBooking).not.toHaveBeenCalled(); expect(service.createPlan).not.toHaveBeenCalled();
  });
  it('a signed CUSTOMER token creates both variants with the JWT actor and HTTP201', async () => {
    const auth = 'Bearer ' + token('CUSTOMER');
    const response = await request(app.getHttpServer()).post('/api/v1/bookings').set('Authorization', auth).send(single);
    expect(response.status).toBe(201); expect(response.body.id).toBe('81'); expect(service.createBooking).toHaveBeenCalledWith(expect.objectContaining({ userId: '17', shopId: '1', requestKey: single.requestKey, contact }));
    const body = { ...plan, contact, startTime: '10:00', paymentMode: 'PAY_AT_STORE', requestKey: 'three-end-plan-key' };
    expect((await request(app.getHttpServer()).post('/api/v1/bookings/plan').set('Authorization', auth).send(body)).status).toBe(201);
    expect(service.createPlan).toHaveBeenCalledWith({ ...body, userId: '17' });
  });
  it('forged JWTs and injected actor/price fields cannot reach creation', async () => {
    const valid = token('CUSTOMER'), forged = valid.slice(0, -10) + 'aaaaaaaaaa';
    expect((await request(app.getHttpServer()).post('/api/v1/bookings').set('Authorization', 'Bearer ' + forged).send(single)).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/api/v1/bookings').set('Authorization', 'Bearer ' + valid).send({ ...single, userId: '99', totalCents: 1 })).status).toBe(400);
    expect(service.createBooking).not.toHaveBeenCalled();
  });
  it('routes status cancellation and the cancel alias with the authenticated actor, operation key and raw reason', async () => {
    const auth = 'Bearer ' + token('ADMIN');
    const key = 'cancel-route-key';
    const cancelReason = '  Changed plans  ';
    const statusRoute = '/api/v1/bookings/81/status?status=CANCELLED';
    expect((await request(app.getHttpServer()).patch(statusRoute).set('Authorization', auth).set('Idempotency-Key', key).send({ cancelReason })).status).toBe(200);
    expect(service.updateBookingStatus).toHaveBeenCalledWith('81', '17', 'CANCELLED', 'ADMIN', key, cancelReason);
    expect((await request(app.getHttpServer()).post('/api/v1/bookings/81/cancel').set('Authorization', auth).set('Idempotency-Key', key).send({ cancelReason: 17 })).status).toBe(201);
    expect(service.cancelBooking).toHaveBeenCalledWith('81', '17', 'ADMIN', key, 17);
  });
  it.each(['', '/plan'])('authenticated %s creation rejects missing, malformed or authority-injected contact at the HTTP boundary', async suffix => {
    const body = suffix ? { ...plan, startTime: '10:00', requestKey: 'three-end-contact-plan-key' } : single;
    for (const invalid of [undefined, null, { ...contact, name: '' }, { ...contact, phone: '2025550100' }, { ...contact, email: 'invalid' }, { ...contact, verified: true }]) {
      const response = await request(app.getHttpServer()).post('/api/v1/bookings' + suffix).set('Authorization', 'Bearer ' + token('CUSTOMER')).send({ ...body, contact: invalid });
      expect(response.status).toBe(400);
    }
    expect(service.createBooking).not.toHaveBeenCalled(); expect(service.createPlan).not.toHaveBeenCalled();
  });
});
