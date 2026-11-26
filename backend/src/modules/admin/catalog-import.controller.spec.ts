import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { CatalogImportController } from './catalog-import.controller';
import { CatalogImportService } from './catalog-import.service';
import { RolesGuard } from '../../common/guards/roles.guard';
const request = require('supertest');
const secret = 'Synthetic-Catalog-Route-Only-2026-abcdef0123456789';
@Injectable()
class RouteJwt extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret, algorithms: ['HS256'] }); }
  validate(payload: any) { return { id: payload.sub, role: payload.role }; }
}
describe('catalog import ADMIN HTTP boundary', () => {
  let app: INestApplication, jwt: JwtService;
  const service = { preview: jest.fn(async () => ({ canApply: false })), apply: jest.fn(async () => ({ replayed: false })), result: jest.fn(async () => ({ found: false })), resolve: jest.fn(async () => ({ found: true, state: 'NOT_APPLIED' })) };
  const body = { shopId: '11', text: 'name,category,duration_minutes,price_usd\nMassage,MASSAGE,60,50' }, key = 'http-catalog-key', digest = 'a'.repeat(64), base = '/api/v1/admin/catalog-import';
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [CatalogImportController], providers: [RouteJwt, RolesGuard, { provide: CatalogImportService, useValue: service }] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })); await app.init(); jwt = module.get(JwtService);
  });
  beforeEach(() => jest.clearAllMocks()); afterAll(async () => { await app.close(); });
  const routes = () => [['post', '/preview', body], ['post', '/apply', { ...body, previewToken: 'synthetic', requestKey: key }], ['post', '/resolve', { shopId: '11', requestKey: key, packageDigest: digest }], ['get', '/result/' + key, undefined]] as const;
  const call = (method: string, path: string, payload: any, token?: string) => { let pending = request(app.getHttpServer())[method](base + path); if (token) pending = pending.set('Authorization', 'Bearer ' + token); return payload ? pending.send(payload) : pending; };
  test.each(['ANONYMOUS', 'MERCHANT', 'CUSTOMER', 'STAFF'])('%s cannot reach any import operation', async role => {
    for (const [method, path, payload] of routes()) expect((await call(method, path, payload, role === 'ANONYMOUS' ? undefined : jwt.sign({ sub: '7', role }))).status).toBe(role === 'ANONYMOUS' ? 401 : 403);
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });
  test('ADMIN receives all HTTP200/no-store and actor comes exclusively from verified JWT', async () => {
    const token = jwt.sign({ sub: '7', role: 'ADMIN' }); for (const [method, path, payload] of routes()) { const result = await call(method, path, payload, token); expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); }
    expect(service.preview).toHaveBeenCalledWith({ id: '7', role: 'ADMIN' }, body.shopId, body.text);
    expect(service.apply).toHaveBeenCalledWith({ id: '7', role: 'ADMIN' }, body.shopId, body.text, 'synthetic', key);
    expect(service.resolve).toHaveBeenCalledWith({ id: '7', role: 'ADMIN' }, '11', key, digest);
    expect(service.result).toHaveBeenCalledWith({ id: '7', role: 'ADMIN' }, key);
  });
  test('foreign actor/write options, malformed body and forged JWT never reach business service', async () => {
    const token = jwt.sign({ sub: '7', role: 'ADMIN' });
    for (const [path, payload] of [['/preview', { ...body, actorId: '99' }], ['/preview', { ...body, shopId: 11 }], ['/preview', { ...body, text: [] }], ['/apply', { ...body, previewToken: 'x', requestKey: 'bad' }], ['/apply', { ...body, previewToken: 'x', requestKey: key, isActive: true }], ['/resolve', { shopId: '11', requestKey: key, packageDigest: 'BAD' }]] as any[]) expect((await call('post', path, payload, token)).status).toBe(400);
    expect((await call('post', '/preview', body, token.slice(0, -10) + 'AAAAAAAAAA')).status).toBe(401);
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });
});
