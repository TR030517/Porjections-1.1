import 'reflect-metadata';
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RolesGuard } from '../../common/guards/roles.guard';
import { parseProjectCatalogQuery } from '../../common/project-catalog-reader';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
const request = require('supertest');
const secret = 'Synthetic-project-catalog-route-only-2026-0123456789abcdef';
@Injectable()
class ProjectCatalogRouteJwt extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret, algorithms: ['HS256'] }); }
  validate(payload: any) { return { id: payload.sub, role: payload.role }; }
}

describe('safe project catalog read route', () => {
  let app: INestApplication, jwt: JwtService;
  const service = { projectCatalog: jest.fn(async (shopId: string, _actor: any, query: any) => ({ shopId, ...parseProjectCatalogQuery(query),
    total: 0, hasMore: false, canManageCatalog: false, canConfigurePolicy: true, items: [] })) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [ReservationsController],
      providers: [ProjectCatalogRouteJwt, RolesGuard, { provide: ReservationsService, useValue: service }] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init(); jwt = module.get(JwtService);
  });
  beforeEach(() => jest.clearAllMocks()); afterAll(async () => { await app.close(); });

  test.each(['ANONYMOUS', 'CUSTOMER'])('%s cannot call the management reader', async role => {
    const call = request(app.getHttpServer()).get('/api/v1/reservation-admin/shops/10/project-catalog');
    if (role !== 'ANONYMOUS') call.set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role }));
    expect((await call).status).toBe(role === 'ANONYMOUS' ? 401 : 403); expect(service.projectCatalog).not.toHaveBeenCalled();
  });

  test.each(['ADMIN', 'MERCHANT', 'STAFF'])('%s reaches a no-store reader with verified actor and exact focus, with grants checked by the service', async role => {
    const response = await request(app.getHttpServer()).get('/api/v1/reservation-admin/shops/10/project-catalog?search=%20Needle%20&status=inactive&page=1&pageSize=25&serviceId=9007199254740993')
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role }));
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(service.projectCatalog).toHaveBeenCalledWith('10', { id: '7', role }, expect.objectContaining({ search: ' Needle ', status: 'inactive', serviceId: '9007199254740993' }));
    expect(response.body).toMatchObject({ shopId: '10', search: 'Needle', serviceId: '9007199254740993', canManageCatalog: false, canConfigurePolicy: true });
  });

  test.each(['search=first&search=second', 'status=all&status=active', 'page=1&page=2', 'page=01', 'status=ACTIVE', 'serviceId=01', 'q=alias', 'actorId=99', 'shopId=11', 'search=%00'])('ambiguous or forged query parameters reject before the reader (%s)', async query => {
    const response = await request(app.getHttpServer()).get('/api/v1/reservation-admin/shops/10/project-catalog?' + query)
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role: 'MERCHANT' }));
    expect(response.status).toBe(400); expect(service.projectCatalog).not.toHaveBeenCalled();
  });

  test.each(['pageSize=51', 'page=100001', 'serviceId=9223372036854775808'])('reader bounds remain authoritative after DTO parsing (%s)', async query => {
    expect((await request(app.getHttpServer()).get('/api/v1/reservation-admin/shops/10/project-catalog?' + query)
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role: 'STAFF' }))).status).toBe(400);
  });

  test('no mutation verb or forged JWT can use the read endpoint', async () => {
    const route = '/api/v1/reservation-admin/shops/10/project-catalog', token = jwt.sign({ sub: '7', role: 'ADMIN' });
    for (const method of ['post', 'patch', 'delete']) expect((await request(app.getHttpServer())[method](route).set('Authorization', 'Bearer ' + token).send({})).status).toBe(404);
    expect((await request(app.getHttpServer()).get(route).set('Authorization', 'Bearer ' + token.slice(0, -10) + 'AAAAAAAAAA')).status).toBe(401);
    expect(service.projectCatalog).not.toHaveBeenCalled();
  });
});
