import 'reflect-metadata';
import { INestApplication, Injectable, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ServiceWorkspaceController } from './service-workspace.controller';
import { ServiceWorkspaceService } from './service-workspace.service';
import { parseWorkspaceCommand } from './service-workspace.dto';

const request = require('supertest'), secret = 'synthetic-workspace-controller-only-secret';
@Injectable()
class WorkspaceTestJwt extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret, algorithms: ['HS256'] }); }
  validate(payload: any) { return { id: payload.sub, role: payload.role }; }
}
/** Authenticated Nest routing/validation contract with a substituted service.
 * Does not verify business persistence, SQL or a running Massajoy API. */
describe('workspace authenticated route contract (substituted service)', () => {
  let app: INestApplication, jwt: JwtService;
  const service = {
    execute: jest.fn(async (_shop: string, _actor: any, body: unknown) => parseWorkspaceCommand(body)),
    snapshot: jest.fn(async () => ({ shopId: '10', service: null })),
    receipt: jest.fn(async () => ({ outcome: 'COMMITTED' })), reconcile: jest.fn(async () => ({ outcome: 'NOT_EXECUTED' })),
  };
  const path = '/api/v1/reservation-admin/shops/10/service-workspace-actions';
  const body = { action: 'SAVE_SERVICE_WORKSPACE', idempotencyKey: 'workspace-route-synthetic', expectedPriceMenuRevision: 'a'.repeat(64),
    service: { name: 'Synthetic', isActive: false }, variants: [{ tempKey: 'first', changes: { name: '60 min', durationMin: 60, priceCents: 6000, isActive: false, sortOrder: 0 } }] };
  const auth = (role: string) => 'Bearer ' + jwt.sign({ sub: '7', role });
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PassportModule, JwtModule.register({ secret })], controllers: [ServiceWorkspaceController],
      providers: [WorkspaceTestJwt, RolesGuard, { provide: ServiceWorkspaceService, useValue: service }] }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init(); jwt = module.get(JwtService);
  });
  beforeEach(() => jest.clearAllMocks()); afterAll(async () => { await app.close(); });
  test.each(['ADMIN', 'MERCHANT', 'STAFF'])('%s route preserves strict DTO values and delegates only authenticated actor', async role => {
    const response = await request(app.getHttpServer()).post(path).set('Authorization', auth(role)).send(body);
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual(body); expect(service.execute).toHaveBeenCalledWith('10', { id: '7', role }, expect.anything());
  });
  test.each(['ANONYMOUS', 'CUSTOMER'])('%s cannot execute or inspect snapshots or receipts', async role => {
    for (const suffix of ['', '/snapshot', '/workspace-route-synthetic', '/workspace-route-synthetic/reconcile']) {
      const call = request(app.getHttpServer())[suffix === '' || suffix.endsWith('reconcile') ? 'post' : 'get'](path + suffix);
      if (role !== 'ANONYMOUS') call.set('Authorization', auth(role));
      expect((await call.send(suffix === '' ? body : {})).status).toBe(role === 'ANONYMOUS' ? 401 : 403);
    }
    expect(service.execute).not.toHaveBeenCalled(); expect(service.snapshot).not.toHaveBeenCalled(); expect(service.receipt).not.toHaveBeenCalled(); expect(service.reconcile).not.toHaveBeenCalled();
  });
  test('static snapshot route, receipt and reconciliation have explicit no-store responses', async () => {
    const snapshot = await request(app.getHttpServer()).get(path + '/snapshot?serviceId=20').set('Authorization', auth('MERCHANT'));
    expect(snapshot.status).toBe(200); expect(snapshot.headers['cache-control']).toBe('no-store'); expect(service.snapshot).toHaveBeenCalledWith('10', { id: '7', role: 'MERCHANT' }, '20'); expect(service.receipt).not.toHaveBeenCalled();
    const receipt = await request(app.getHttpServer()).get(path + '/workspace-route-synthetic').set('Authorization', auth('MERCHANT'));
    expect(receipt.status).toBe(200); expect(receipt.headers['cache-control']).toBe('no-store');
    const reconciliation = await request(app.getHttpServer()).post(path + '/workspace-route-synthetic/reconcile').set('Authorization', auth('MERCHANT')).send({});
    expect(reconciliation.status).toBe(200); expect(reconciliation.body.outcome).toBe('NOT_EXECUTED'); expect(reconciliation.headers['cache-control']).toBe('no-store');
  });
  test('global transformation preserves nested scalar types and rejects forbidden structural fields', async () => {
    for (const input of [{ ...body, actorId: '1' },
      { ...body, service: { name: 'Test', requiredStaffCount: 2 } }, { ...body, confirm: true }]) {
      expect((await request(app.getHttpServer()).post(path).set('Authorization', auth('ADMIN')).send(input)).status).toBe(400);
    }
    // This substituted route only parses command structure. The real service's
    // scalar rejection is exercised in service-workspace.service.spec.ts.
    const uncoerced = await request(app.getHttpServer()).post(path).set('Authorization', auth('ADMIN')).send({ ...body,
      variants: [{ tempKey: 'first', changes: { name: '60 min', durationMin: '60', priceCents: 6000 } }] });
    expect(uncoerced.body.variants[0].changes.durationMin).toBe('60');
    expect((await request(app.getHttpServer()).get(path + '/snapshot?serviceId=20&actorId=1').set('Authorization', auth('ADMIN'))).status).toBe(400);
    expect((await request(app.getHttpServer()).post(path + '/workspace-route-synthetic/reconcile').set('Authorization', auth('ADMIN')).send({ serviceId: '20' })).status).toBe(400);
    expect(service.reconcile).not.toHaveBeenCalled();
  });
});
