import { ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';

const request = require('supertest');

describe('Audit query HTTP contract, authorization and privacy (synthetic repository only)', () => {
  let app: INestApplication;
  let service: AuditLogService;
  const auditLog = { findMany: jest.fn(), count: jest.fn(), create: jest.fn() };
  const row = {
    id: 8n, action: 'STUDIO_UPDATE', targetType: 'stores', targetId: 9007199254740993n,
    operatorId: 3n, createdAt: new Date('2026-10-27T16:30:00.000Z'),
    detail: {
      fields: ['status', 'timezone', 'password', 'accessToken', 'email', 'status', '<script>'],
      previousStatus: 'PENDING', newStatus: 'APPROVED', reason: 'sensitive-reason-marker',
      phone: 'sensitive-contact-marker', password: 'sensitive-password-marker',
      before: { email: 'sensitive-before-marker' }, revokedSessions: 2,
    },
    operator: { id: 3n, name: 'sensitive-name-marker', phone: 'sensitive-operator-marker' },
  };
  const get = (url = '/api/v1/admin/audit-logs', role = 'ADMIN') => request(app.getHttpServer()).get(url).set('x-synthetic-role', role);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuditLogController], providers: [AuditLogService, RolesGuard,
        { provide: PrismaService, useValue: { auditLog } }],
    }).overrideGuard(AuthGuard('jwt')).useValue({
      canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        const role = req.headers['x-synthetic-role'];
        if (!role) throw new UnauthorizedException();
        req.user = { id: '3', role };
        return true;
      },
    }).compile();
    service = module.get(AuditLogService);
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    jest.clearAllMocks(); auditLog.findMany.mockResolvedValue([row]); auditLog.count.mockResolvedValue(21);
  });

  test('unauthenticated requests cannot reach the repository', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/audit-logs').expect(401);
    expect(auditLog.findMany).not.toHaveBeenCalled();
  });
  test.each(['MERCHANT', 'USER'])('%s cannot list or directly read target histories', async role => {
    await get(undefined, role).expect(403);
    await get('/api/v1/admin/audit-logs/SHOP/1', role).expect(403);
    expect(auditLog.findMany).not.toHaveBeenCalled();
  });
  test('default pagination is bounded and responses omit raw details and operator PII', async () => {
    const { body } = await get().expect(200);
    expect(body.meta).toEqual({ total: 21, page: 1, limit: 20, totalPages: 2 });
    expect(body.items[0]).toMatchObject({
      id: '8', targetId: '9007199254740993', operatorId: '3', operator: { id: '3' },
      detail: { fields: ['status', 'timezone'], previousStatus: 'PENDING', newStatus: 'APPROVED', reasonRecorded: true, revokedSessions: 2 },
    });
    expect(JSON.stringify(body)).not.toContain('sensitive-');
    expect(body.items[0].detail).not.toHaveProperty('reason');
    const args = auditLog.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ take: 20, skip: 0, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(args.select).not.toHaveProperty('operator');
  });
  test('account reset reasons remain persisted internally but only a safe presence flag reaches HTTP', async () => {
    auditLog.findMany.mockResolvedValue([{...row,action:'SHOP_LOGIN_PASSWORD_RESET',targetType:'SHOP_ACCOUNT',detail:{fields:['passwordReset','loginName','passwordHash'],reason:'sensitive-reset-purpose',revokedSessions:3}}]);
    const {body}=await get().expect(200);
    expect(body.items[0].detail).toEqual({fields:['passwordReset','loginName'],reasonRecorded:true,revokedSessions:3});
    expect(JSON.stringify(body)).not.toMatch(/sensitive-reset|passwordHash/);
    auditLog.findMany.mockResolvedValue([{...row,detail:{reasonRecorded:true,reason:'',fields:['loginBinding']}}]);
    expect((await get().expect(200)).body.items[0].detail).toEqual({fields:['loginBinding'],reasonRecorded:true});
  });
  test('exact codes, full precision IDs, page offsets and inclusive UTC dates reach the query', async () => {
    await get().query({ targetType: 'service-orders', action: 'STUDIO_UPDATE', targetId: '9007199254740993', operatorId: '9223372036854775807', startDate: '2026-10-27', endDate: '2026-10-27', page: '2', limit: '100' }).expect(200);
    expect(auditLog.findMany.mock.calls[0][0]).toMatchObject({ skip: 100, take: 100, where: {
      targetType: 'service-orders', action: 'STUDIO_UPDATE', targetId: 9007199254740993n, operatorId: 9223372036854775807n,
      createdAt: { gte: new Date('2026-10-27T00:00:00.000Z'), lte: new Date('2026-10-27T23:59:59.999Z') },
    } });
    expect(auditLog.count.mock.calls[0][0].where).toEqual(auditLog.findMany.mock.calls[0][0].where);
  });
  test.each([
    { page: '0' }, { page: '-1' }, { page: '1.5' }, { page: '1e2' }, { page: '1abc' },
    { page: '100001' }, { page: '' }, { limit: '0' }, { limit: '101' }, { limit: '999999999999999999999' },
    { targetId: '0' }, { targetId: '01' }, { targetId: '1.2' }, { targetId: '9223372036854775808' },
    { operatorId: '-1' }, { operatorId: '1e2' }, { targetType: 'stores/../../users' },
    { targetType: 'x'.repeat(51) }, { action: 'x'.repeat(101) }, { action: '<script>' },
    { startDate: '2026-02-30' }, { endDate: '2026-13-01' }, { startDate: '2026-10-27T00:00:00Z' },
    { startDate: '2026-10-28', endDate: '2026-10-27' }, { arbitrary: 'not-permitted' },
  ])('malformed query %# is rejected before repository access', async query => {
    await get().query(query).expect(400);
    expect(auditLog.findMany).not.toHaveBeenCalled(); expect(auditLog.count).not.toHaveBeenCalled();
  });
  test('repeated query parameters cannot bypass scalar validation', async () => {
    await get('/api/v1/admin/audit-logs?page=1&page=2').expect(400);
    expect(auditLog.findMany).not.toHaveBeenCalled();
  });
  test.each(['SHOP', 'BOOKING', 'stores', 'service-orders'])('entity history %s remains compatible and bounded', async target => {
    const { body } = await get(`/api/v1/admin/audit-logs/${target}/1`).expect(200);
    expect(Array.isArray(body)).toBe(true); expect(JSON.stringify(body)).not.toContain('sensitive-');
    expect(auditLog.findMany.mock.calls[0][0]).toMatchObject({ where: { targetType: target, targetId: 1n }, take: 20, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  });
  test('entity history permits a caller-specified bounded limit but not unlimited or malformed IDs', async () => {
    await get('/api/v1/admin/audit-logs/SHOP/1?limit=100').expect(200);
    expect(auditLog.findMany.mock.calls[0][0].take).toBe(100);
    jest.clearAllMocks();
    await get('/api/v1/admin/audit-logs/SHOP/1?limit=101').expect(400);
    await get('/api/v1/admin/audit-logs/SHOP/9223372036854775808').expect(400);
    await get('/api/v1/admin/audit-logs/SHOP/1abc').expect(400);
    expect(auditLog.findMany).not.toHaveBeenCalled();
  });
  test('empty histories remain real empty results', async () => {
    auditLog.findMany.mockResolvedValue([]); auditLog.count.mockResolvedValue(0);
    const { body } = await get().expect(200);
    expect(body).toEqual({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });
  test('internal callers receive the same bounds without relying on a controller pipe', async () => {
    await expect(service.findAll({ page: -1 })).rejects.toThrow('range');
    await expect(service.findAll({ operatorId: '9223372036854775808' })).rejects.toThrow('BigInt');
    await expect(service.findByTarget('SHOP', '1', 1000)).rejects.toThrow('range');
    await expect(service.findByTarget('SHOP', '1.2')).rejects.toThrow('BigInt');
    expect(auditLog.findMany).not.toHaveBeenCalled();
  });
  test('existing audit writers retain their payload and create result', async () => {
    const input = { action: 'APPROVE', targetType: 'SHOP', targetId: '12', operatorId: '3', detail: { reason: 'synthetic decision', previousStatus: 'PENDING' } };
    auditLog.create.mockResolvedValue({ id: 9n });
    expect(await service.create(input)).toEqual({ id: 9n });
    expect(auditLog.create).toHaveBeenCalledWith({ data: { ...input, targetId: 12n, operatorId: 3n } });
  });
});
