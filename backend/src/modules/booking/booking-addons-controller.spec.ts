import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { SettlementService } from './settlement.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
const request = require('supertest');
const secret = 'SyntheticAddOnHttpGuardOnly-UniqueKey-2035';
@Injectable()
class AddOnTestStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret }); }
  validate(payload: { sub: string; role: string }) { return { id: payload.sub, role: payload.role }; }
}

describe('authenticated add-on quote routes and strict nested DTOs', () => {
  let app: INestApplication, jwt: JwtService;
  const service = { quoteBooking: jest.fn(async () => ({ totalCents: 6000, quoteHash: 'a'.repeat(64) })), quotePlan: jest.fn(async () => ({ totalCents: 6000 })), createBooking: jest.fn(async () => ({ id: '90' })) };
  const selection = [{ participantIndex: 1, sequence: 1, addOnIds: ['2'] }];
  const single = { shopId: '10', serviceId: '20', date: '2035-01-01', startTime: '09:00', addOnSelections: selection };
  const plan = { shopId: '10', date: '2035-01-01', startTime: '09:00', items: [{ participantIndex: 1, sequence: 1, serviceId: '20' }], addOnSelections: selection };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [BookingController], providers: [AddOnTestStrategy, JwtAuthGuard, RolesGuard, { provide: BookingService, useValue: service }, { provide: SettlementService, useValue: {} }] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());
  const auth = (role: string) => 'Bearer ' + jwt.sign({ sub: '17', role });
  test('anonymous and management roles cannot request either customer-specific signed quote', async () => {
    for (const [route, body] of [['quote', single], ['plan-quote', plan]] as const) {
      expect((await request(app.getHttpServer()).post('/api/v1/bookings/' + route).send(body)).status).toBe(401);
      for (const role of ['ADMIN', 'MERCHANT', 'STAFF']) expect((await request(app.getHttpServer()).post('/api/v1/bookings/' + route).set('Authorization', auth(role)).send(body)).status).toBe(403);
    }
    expect(service.quoteBooking).not.toHaveBeenCalled(); expect(service.quotePlan).not.toHaveBeenCalled();
  });
  test('customer quote uses JWT identity without a request key, and create explicitly forwards the signed token and attachments', async () => {
    expect((await request(app.getHttpServer()).post('/api/v1/bookings/quote').set('Authorization', auth('CUSTOMER')).send(single)).status).toBe(200);
    expect(service.quoteBooking).toHaveBeenCalledWith({ ...single, userId: '17' });
    expect((await request(app.getHttpServer()).post('/api/v1/bookings/plan-quote').set('Authorization', auth('CUSTOMER')).send(plan)).status).toBe(200);
    expect(service.quotePlan).toHaveBeenCalledWith({ ...plan, userId: '17' });
    const body = { ...single, contact: { name: 'Synthetic customer', phone: '+12025550100', email: 'synthetic.addon@example.test' }, requestKey: 'synthetic-addon-controller-01', quoteHash: 'a'.repeat(64), quoteExpiresAt: '2035-01-01T00:00:00.000Z' };
    expect((await request(app.getHttpServer()).post('/api/v1/bookings').set('Authorization', auth('CUSTOMER')).send(body)).status).toBe(201);
    expect(service.createBooking).toHaveBeenCalledWith(expect.objectContaining({ userId: '17', contact: body.contact, addOnSelections: selection, quoteHash: body.quoteHash, quoteExpiresAt: body.quoteExpiresAt, requestKey: body.requestKey }));
  });
  test('quote rejects injected actors, monetary values, quantities and string coordinates before the business service', async () => {
    for (const patch of [{ userId: '99' }, { priceCents: 1 }, { quoteHash: 'a'.repeat(64) }, { contact: { name: 'Synthetic', phone: '+12025550100', email: 'synthetic@example.test' } }, { addOnSelections: [{ ...selection[0], quantity: 2 }] }, { addOnSelections: [{ ...selection[0], participantIndex: '1' }] }, { addOnSelections: [{ ...selection[0], addOnIds: [2] }] }]) {
      expect((await request(app.getHttpServer()).post('/api/v1/bookings/quote').set('Authorization', auth('CUSTOMER')).send({ ...single, ...patch })).status).toBe(400);
    }
    expect(service.quoteBooking).not.toHaveBeenCalled();
  });
});
