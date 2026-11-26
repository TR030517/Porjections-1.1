import { INestApplication, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RolesGuard } from '../common/guards/roles.guard';
import { FavoritesController } from './favorites/favorites.controller';
import { FavoritesService } from './favorites/favorites.service';
import { CouponsController } from './coupons/coupons.controller';
import { CouponsService } from './coupons/coupons.service';
import { ReviewsController } from './reviews/reviews.controller';
import { ReviewsService } from './reviews/reviews.service';
import { GiftCardAdminController, GiftCardPublicController, GiftCardsController } from './gift-cards/gift-cards.controller';
import { GiftCardsService } from './gift-cards/gift-cards.service';
import { PaymentController } from './payment/payment.controller';
import { PaymentService } from './payment/payment.service';

const request = require('supertest');
const secret = 'Synthetic-customer-personal-routes-only-2026-abcdef0123456789';

@Injectable()
class CustomerRouteJwt extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret, algorithms: ['HS256'] }); }
  validate(payload: { sub: string; role: string }) { return { id: payload.sub, role: payload.role }; }
}

type Route = { method: 'get' | 'post' | 'patch' | 'delete'; path: string; body?: Record<string, unknown> };

describe('customer-only personal route role boundaries', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const favorites = {
    toggle: jest.fn(async () => ({ favorited: true })), listIds: jest.fn(async () => []),
    listShops: jest.fn(async () => []), isFavorited: jest.fn(async () => false),
  };
  const coupons = {
    listClaimable: jest.fn(async () => []), claim: jest.fn(async () => ({})),
    myCoupons: jest.fn(async () => []), validateCoupon: jest.fn(async () => ({})),
  };
  const reviews = {
    create: jest.fn(async () => ({})), listMyReviews: jest.fn(async () => []),
    listByShop: jest.fn(async () => ({ items: [] })), update: jest.fn(async () => ({})), delete: jest.fn(async () => ({})),
  };
  const gifts = {
    config: jest.fn(() => ({ salesEnabled: true })), products: jest.fn(async () => ({ items: [] })), product: jest.fn(async () => ({})),
    salesPolicy: jest.fn(async () => ({ payAtStoreEnabled: true })),
    orders: jest.fn(async () => ({ items: [] })), order: jest.fn(async () => ({})), createOrder: jest.fn(async () => ({})),
    cancelOrder: jest.fn(async () => ({})), checkout: jest.fn(async () => ({})), entitlements: jest.fn(async () => ({ items: [] })),
    entitlement: jest.fn(async () => ({})), ownRedemptions: jest.fn(async () => ({ items: [] })), credential: jest.fn(async () => ({})),
  };
  const payments = {
    config: jest.fn(() => ({ onlinePaymentEnabled: false })), quote: jest.fn(async () => ({})),
    createPaymentIntent: jest.fn(async () => ({})), confirmPaymentIntent: jest.fn(async () => ({})), reconcileBooking: jest.fn(async () => ({})),
  };

  const personalRoutes: Route[] = [
    { method: 'get', path: '/favorites' },
    { method: 'get', path: '/favorites/shops' },
    { method: 'get', path: '/favorites/10/check' },
    { method: 'post', path: '/favorites/10/toggle' },
    { method: 'get', path: '/coupons' },
    { method: 'post', path: '/coupons/10/claim' },
    { method: 'get', path: '/users/me/coupons' },
    { method: 'post', path: '/coupons/validate', body: { couponId: '10', shopId: '20', priceCents: 5000 } },
    { method: 'post', path: '/reviews', body: { bookingId: '10', rating: 5 } },
    { method: 'get', path: '/reviews/my' },
    { method: 'patch', path: '/reviews/10', body: { rating: 4 } },
    { method: 'delete', path: '/reviews/10' },
    { method: 'get', path: '/gift-cards/orders' },
    { method: 'get', path: '/gift-cards/orders/10' },
    { method: 'post', path: '/gift-cards/orders', body: { productId: '10', requestKey: 'customer-route-test' } },
    { method: 'post', path: '/gift-cards/orders/10/cancel', body: {} },
    { method: 'post', path: '/gift-cards/orders/10/checkout', body: {} },
    { method: 'get', path: '/gift-cards/entitlements' },
    { method: 'get', path: '/gift-cards/entitlements/10' },
    { method: 'get', path: '/gift-cards/entitlements/10/redemptions' },
    { method: 'post', path: '/gift-cards/entitlements/10/credential', body: { usedUses: 1 } },
    { method: 'post', path: '/payments/quote', body: { bookingId: '10' } },
    { method: 'post', path: '/payments/create-intent', body: { bookingId: '10' } },
    { method: 'post', path: '/payments/confirm', body: { paymentIntentId: 'pi_synthetic' } },
  ];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [FavoritesController, CouponsController, ReviewsController, GiftCardPublicController, GiftCardsController, GiftCardAdminController, PaymentController],
      providers: [
        CustomerRouteJwt, RolesGuard,
        { provide: FavoritesService, useValue: favorites }, { provide: CouponsService, useValue: coupons },
        { provide: ReviewsService, useValue: reviews }, { provide: GiftCardsService, useValue: gifts },
        { provide: PaymentService, useValue: payments },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
    jwt = module.get(JwtService);
  });

  beforeEach(() => {
    for (const service of [favorites, coupons, reviews, gifts, payments]) {
      for (const method of Object.values(service)) if (jest.isMockFunction(method)) method.mockClear();
    }
  });
  afterAll(async () => app.close());

  const token = (role: string) => jwt.sign({ sub: '42', role });
  const call = (route: Route, role?: string) => {
    let req = request(app.getHttpServer())[route.method]('/api/v1' + route.path);
    if (role) req = req.set('Authorization', 'Bearer ' + token(role));
    if (route.body) req = req.send(route.body);
    return req;
  };

  test.each(['ADMIN', 'MERCHANT', 'STAFF'])('%s cannot access customer-owned personal routes', async role => {
    for (const route of personalRoutes) expect((await call(route, role)).status).toBe(403);
    for (const service of [favorites, coupons, reviews, gifts, payments]) {
      for (const method of Object.values(service)) if (jest.isMockFunction(method)) expect(method).not.toHaveBeenCalled();
    }
  });

  test('anonymous users cannot access personal data', async () => {
    for (const route of personalRoutes) expect((await call(route)).status).toBe(401);
  });

  test('customers retain access using their JWT identity; public catalogs and reviews remain public', async () => {
    for (const route of personalRoutes) expect((await call(route, 'CUSTOMER')).status).toBe(route.method === 'get' || route.method === 'patch' || route.method === 'delete' ? 200 : 201);
    expect(favorites.listIds).toHaveBeenCalledWith('42');
    expect(coupons.myCoupons).toHaveBeenCalledWith('42', undefined);
    expect(reviews.listMyReviews).toHaveBeenCalledWith('42');
    expect(gifts.orders).toHaveBeenCalledWith('42', {});
    expect(payments.quote).toHaveBeenCalledWith('10', '42');
    expect(payments.createPaymentIntent).toHaveBeenCalledWith({ bookingId: '10', userId: '42' });
    expect(payments.confirmPaymentIntent).toHaveBeenCalledWith({ paymentIntentId: 'pi_synthetic', userId: '42' });
    expect((await request(app.getHttpServer()).get('/api/v1/reviews/shop/20')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/api/v1/gift-cards/products')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/api/v1/payments/config')).status).toBe(200);
  });

  test('merchant operations and payment reconciliation keep their separate access paths', async () => {
    const merchantToken = 'Bearer ' + token('MERCHANT');
    const adminRoute = await request(app.getHttpServer()).get('/api/v1/gift-cards/admin/shops/20/sales-policy').set('Authorization', merchantToken);
    expect(adminRoute.status).toBe(200);
    expect(gifts.salesPolicy).toHaveBeenCalledWith({ id: '42', role: 'MERCHANT' }, '20');
    const reconciliation = await request(app.getHttpServer()).post('/api/v1/payments/bookings/10/reconcile').set('Authorization', merchantToken).send({});
    expect(reconciliation.status).toBe(201);
    expect(payments.reconcileBooking).toHaveBeenCalledWith('10', '42', 'MERCHANT');
    expect((await request(app.getHttpServer()).get('/api/v1/gift-cards/admin/shops/20/sales-policy').set('Authorization', 'Bearer ' + token('CUSTOMER'))).status).toBe(403);
  });
});
