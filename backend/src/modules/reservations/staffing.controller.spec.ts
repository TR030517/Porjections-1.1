import 'reflect-metadata';
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
const request = require('supertest');
const secret = 'Synthetic-staffing-route-only-2035-0123456789abcdef';
@Injectable()
class StaffingRouteJwt extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret, algorithms: ['HS256'] }); }
  validate(payload: any) { return { id: payload.sub, role: payload.role }; }
}

describe('staffing target management route', () => {
  let app: INestApplication, jwt: JwtService;
  const view = { shopId: '10', activeCount: 2, revision: 'a'.repeat(64), serviceAccessMode: 'SHOP_ALL',
    canManageStaff: true, canManageExceptions: true, therapists: [] };
  const service = { staffing: jest.fn(async () => view), setStaffing: jest.fn(async () => ({ ...view, createdIds: [], deactivatedIds: [] })) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [ReservationsController],
      providers: [StaffingRouteJwt, RolesGuard, { provide: ReservationsService, useValue: service }] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init(); jwt = module.get(JwtService);
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app.close(); });

  test.each(['ADMIN', 'MERCHANT', 'STAFF'])('%s route passes the verified actor, leaving exact CAT/RES grants to the service', async role => {
    const authorization = 'Bearer ' + jwt.sign({ sub: '7', role }), path = '/api/v1/reservation-admin/shops/10/staffing';
    const read = await request(app.getHttpServer()).get(path).set('Authorization', authorization);
    expect(read.status).toBe(200); expect(read.headers['cache-control']).toBe('no-store');
    expect(service.staffing).toHaveBeenCalledWith('10', { id: '7', role }); expect(read.body).not.toHaveProperty('createdIds');
    const payload = { targetActiveCount: 2, expectedRevision: 'a'.repeat(64) };
    const saved = await request(app.getHttpServer()).patch(path).set('Authorization', authorization).send(payload);
    expect(saved.status).toBe(200); expect(saved.headers['cache-control']).toBe('no-store');
    expect(service.setStaffing).toHaveBeenCalledWith('10', { id: '7', role }, expect.objectContaining(payload));
    expect(saved.body).toMatchObject({ createdIds: [], deactivatedIds: [], activeCount: 2 });
  });

  test.each(['ANONYMOUS', 'CUSTOMER'])('%s cannot read or change shop staffing', async role => {
    for (const method of ['get', 'patch']) {
      const call = request(app.getHttpServer())[method]('/api/v1/reservation-admin/shops/10/staffing');
      if (role !== 'ANONYMOUS') call.set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role }));
      if (method === 'patch') call.send({ targetActiveCount: 2, expectedRevision: 'a'.repeat(64) });
      expect((await call).status).toBe(role === 'ANONYMOUS' ? 401 : 403);
    }
    expect(service.staffing).not.toHaveBeenCalled(); expect(service.setStaffing).not.toHaveBeenCalled();
  });

  test.each([
    {}, { targetActiveCount: '2', expectedRevision: 'a'.repeat(64) }, { targetActiveCount: 1.5, expectedRevision: 'a'.repeat(64) },
    { targetActiveCount: -1, expectedRevision: 'a'.repeat(64) }, { targetActiveCount: 101, expectedRevision: 'a'.repeat(64) },
    { targetActiveCount: true, expectedRevision: 'a'.repeat(64) }, { targetActiveCount: null, expectedRevision: 'a'.repeat(64) },
    { targetActiveCount: 2, expectedRevision: 'A'.repeat(64) }, { targetActiveCount: 2, expectedRevision: 'a'.repeat(64), shopId: '11' },
    { targetActiveCount: 2, expectedRevision: 'a'.repeat(64), scheduleMode: 'SHOP' }, { targetActiveCount: 2, expectedRevision: 'a'.repeat(64), serviceIds: ['99'] },
  ])('rejects coerced counts, missing CAS and policy or cross-shop injection before service dispatch (%p)', async payload => {
    const response = await request(app.getHttpServer()).patch('/api/v1/reservation-admin/shops/10/staffing')
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role: 'MERCHANT' })).send(payload);
    expect(response.status).toBe(400); expect(service.setStaffing).not.toHaveBeenCalled();
  });
});
