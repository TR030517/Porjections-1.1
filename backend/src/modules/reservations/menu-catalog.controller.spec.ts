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
const secret = 'Synthetic-menu-catalog-route-only-2026-abcdef0123456789';
@Injectable()
class CatalogRouteJwt extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret, algorithms: ['HS256'] }); }
  validate(payload: any) { return { id: payload.sub, role: payload.role }; }
}

describe('menu catalog authenticated read route', () => {
  let app: INestApplication, jwt: JwtService;
  const service = { menuCatalog: jest.fn(async (_shopId: string, _actor: any, query: any) => ({
    shopId: '10', kind: query.kind, q: query.q ?? '', page: 1, pageSize: 25, total: 0, hasMore: false, canConfigurePolicy: false, items: [],
  })) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [ReservationsController],
      providers: [CatalogRouteJwt, RolesGuard, { provide: ReservationsService, useValue: service }] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init(); jwt = module.get(JwtService);
  });
  beforeEach(() => jest.clearAllMocks()); afterAll(async () => { await app.close(); });
  test.each(['ANONYMOUS', 'STAFF', 'CUSTOMER'])('%s cannot inherit the broader reservation-controller role list', async role => {
    const call = request(app.getHttpServer()).get('/api/v1/reservation-admin/shops/10/menu-catalog?kind=service');
    if (role !== 'ANONYMOUS') call.set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role }));
    expect((await call).status).toBe(role === 'ANONYMOUS' ? 401 : 403); expect(service.menuCatalog).not.toHaveBeenCalled();
  });
  test.each(['ADMIN', 'MERCHANT'])('%s receives a no-store response using only the verified JWT actor and route shop', async role => {
    const result = await request(app.getHttpServer()).get('/api/v1/reservation-admin/shops/10/menu-catalog?kind=service&q=Massage')
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role }));
    expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(service.menuCatalog).toHaveBeenCalledWith('10', { id: '7', role }, expect.objectContaining({ kind: 'service', q: 'Massage' }));
  });
  test.each(['kind=service&actorId=99', 'kind=service&q=first&q=second', 'kind=service&page=1&page=2', 'kind=service&serviceId=01'])('raw query shape is not silently coerced (%s)', async query => {
    const result = await request(app.getHttpServer()).get('/api/v1/reservation-admin/shops/10/menu-catalog?' + query)
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role: 'MERCHANT' }));
    expect(result.status).toBe(400); expect(service.menuCatalog).not.toHaveBeenCalled();
  });
  test('mutation verbs and forged JWTs cannot reach the read-only method', async () => {
    const token = jwt.sign({ sub: '7', role: 'ADMIN' }), route = '/api/v1/reservation-admin/shops/10/menu-catalog?kind=service';
    for (const method of ['post', 'patch', 'delete']) expect((await request(app.getHttpServer())[method](route).set('Authorization', 'Bearer ' + token).send({})).status).toBe(404);
    expect((await request(app.getHttpServer()).get(route).set('Authorization', 'Bearer ' + token.slice(0, -10) + 'AAAAAAAAAA')).status).toBe(401);
    expect(service.menuCatalog).not.toHaveBeenCalled();
  });
});

