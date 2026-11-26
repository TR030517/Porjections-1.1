import 'reflect-metadata';
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CatalogActionsController } from './catalog-actions.controller';
import { CatalogActionsService } from './catalog-actions.service';
import { parseCatalogMutation } from './catalog-actions.dto';
const request = require('supertest'), secret = 'synthetic-catalog-command-route-0123456789';
@Injectable()
class CommandJwt extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret, algorithms: ['HS256'] }); }
  validate(payload: any) { return { id: payload.sub, role: payload.role }; }
}
describe('catalog command and receipt authenticated routes with real global validation', () => {
  let app: INestApplication, jwt: JwtService;
  const service = { execute: jest.fn(async (_shop: string, _actor: any, body: unknown) => parseCatalogMutation(body)), receipt: jest.fn(async () => ({ operationId: 'synthetic' })) };
  const body = { action: 'CREATE_SERVICE', idempotencyKey: 'synthetic-http-key', expectedPriceMenuRevision: 'a'.repeat(64),
    service: { name: 'Synthetic', isActive: false }, variant: { name: '60 min', durationMin: 60, priceCents: 6000, isActive: false }, display: { groupIndex: 0 } };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [CatalogActionsController],
      providers: [CommandJwt, RolesGuard, { provide: CatalogActionsService, useValue: service }] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init(); jwt = module.get(JwtService);
  });
  beforeEach(() => jest.clearAllMocks()); afterAll(async () => { await app.close(); });
  const path = '/api/v1/reservation-admin/shops/10/catalog-actions';
  test.each(['ADMIN', 'MERCHANT'])('%s uses identical POST fields and authenticated actor, including false and numeric zero', async role => {
    const result = await request(app.getHttpServer()).post(path).set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role })).send(body);
    expect(result.status).toBe(201); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toMatchObject({ service: { isActive: false }, variant: { isActive: false }, display: { groupIndex: 0 } });
    expect(service.execute).toHaveBeenCalledWith('10', { id: '7', role }, expect.objectContaining({ expectedPriceMenuRevision: body.expectedPriceMenuRevision }));
  });
  test.each(['ANONYMOUS', 'CUSTOMER', 'STAFF'])('%s cannot mutate or read receipts', async role => {
    for (const verb of ['get', 'post']) {
      const call = request(app.getHttpServer())[verb](path + (verb === 'get' ? '/synthetic-http-key' : ''));
      if (role !== 'ANONYMOUS') call.set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role }));
      expect((await call.send(body)).status).toBe(role === 'ANONYMOUS' ? 401 : 403);
    }
    expect(service.execute).not.toHaveBeenCalled(); expect(service.receipt).not.toHaveBeenCalled();
  });
  test('receipt GET is no-store and passes only route key/shop and verified actor', async () => {
    const result = await request(app.getHttpServer()).get(path + '/synthetic-http-key').set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role: 'MERCHANT' }));
    expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); expect(service.receipt).toHaveBeenCalledWith('10', { id: '7', role: 'MERCHANT' }, 'synthetic-http-key');
  });
  test('global pipe does not coerce strings or strip nested forbidden fields into valid commands', async () => {
    for (const data of [{ ...body, actorId: '1' }, { ...body, variant: { ...body.variant, durationMin: '60' } },
      { ...body, variant: { ...body.variant, isActive: 'false' } }, { ...body, service: { name: 'Invalid', requiredStaffCount: 2 } }]) {
      const result = await request(app.getHttpServer()).post(path).set('Authorization', 'Bearer ' + jwt.sign({ sub: '7', role: 'ADMIN' })).send(data);
      expect(result.status).toBe(400);
    }
  });
});
