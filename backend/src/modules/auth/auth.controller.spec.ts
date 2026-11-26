import { INestApplication, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CustomerAuthService } from './customer-auth.service';
import { RolesGuard } from '../../common/guards/roles.guard';

const request = require('supertest');
const secret = 'Synthetic-verified-email-auth-routes-2026-abcdef0123456789';

@Injectable()
class VerifiedEmailRouteJwt extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret, algorithms: ['HS256'] }); }
  validate(payload: { sub: string; role: string }) { return { id: payload.sub, role: payload.role }; }
}

describe('verified customer email route boundaries', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const auth = { passwordLogin: jest.fn(async () => ({})) };
  const customer = { verifyCurrentEmail: jest.fn(async () => ({ verified: true })) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [AuthController],
      providers: [VerifiedEmailRouteJwt, RolesGuard, { provide: AuthService, useValue: auth }, { provide: CustomerAuthService, useValue: customer }],
    }).compile();
    app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api/v1'); await app.init(); jwt = module.get(JwtService);
  });
  beforeEach(() => { jest.clearAllMocks(); });
  afterAll(async () => app.close());

  const token = (role: string) => 'Bearer ' + jwt.sign({ sub: '42', role });

  test('legacy direct password registration is retired and cannot create an account', async () => {
    const result = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: 'unverified@example.test', password: 'synthetic-password-only', name: 'Synthetic' });
    expect(result.status).toBe(410);
    expect(result.body).toMatchObject({ code: 'CUSTOMER_REGISTRATION_REQUIRES_VERIFIED_EMAIL' });
    expect((auth as any).register).toBeUndefined();
  });

  test('only a customer session can verify its own saved email challenge', async () => {
    const body = { challengeId: '00000000-0000-4000-8000-000000000001', code: '123456' };
    expect((await request(app.getHttpServer()).post('/api/v1/auth/customer/email/verify-current').send(body)).status).toBe(401);
    for (const role of ['ADMIN', 'MERCHANT', 'STAFF']) {
      expect((await request(app.getHttpServer()).post('/api/v1/auth/customer/email/verify-current').set('Authorization', token(role)).send(body)).status).toBe(403);
    }
    const result = await request(app.getHttpServer()).post('/api/v1/auth/customer/email/verify-current').set('Authorization', token('CUSTOMER')).send(body);
    expect(result.status).toBe(200); expect(result.body).toEqual({ verified: true });
    expect(customer.verifyCurrentEmail).toHaveBeenCalledWith('42', body.challengeId, body.code);
  });
});
