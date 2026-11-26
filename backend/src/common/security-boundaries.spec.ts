import { FcmService } from '../modules/notifications/fcm.service';
import { UploadService } from '../modules/upload/upload.service';
import { StudioService } from '../modules/studio/studio.service';
import { scalarData } from './scalar-data';
import { shopFeatures } from './shop-features';
import { bookingLocalFields } from '../modules/booking/time';
import { PaymentService } from '../modules/payment/payment.service';
import { MerchantService } from '../modules/merchant/merchant.service';
import { requireShopAccess } from './shop-access';

describe('private-data and write boundaries (no network or database)', () => {
  test('merchant shop list has an explicit safe projection and associated access never exposes the target login account', async () => {
    const account={id:3n,name:'Synthetic operator',loginName:'synthetic.shop',email:null,status:'ACTIVE',passwordHash:'PRIVATE_HASH'};
    const row={id:71n,ownerId:99n,name:'Synthetic shop',nameEn:'Synthetic shop',status:'APPROVED',phone:'+12025550100',address:'Protected address',city:'Protected city',state:'WA',zipCode:'98000',latitude:47.6,longitude:-122.3,timezone:'America/Los_Angeles',businessHours:{monday:{open:'09:00',close:'17:00'}},studioProfile:{pay_square_info:{token:'PRIVATE_PROVIDER'}},
      reviewComment:'PRIVATE_REVIEW',reviewedBy:1n,deletedAt:null,shopImages:[],staffGrants:[],
      loginBinding:{userId:3n,user:account},incomingAccountGrants:[{sourceShopId:72n,permissions:['CATALOG_MANAGE']}]};
    const findMany=jest.fn(async(_query:any)=>[row]);
    const service=new MerchantService({user:{findFirst:async()=>({id:1n})},shop:{findMany}} as any,{} as any);
    const [admin]=await service.getMyShops('1','ADMIN');
    expect(admin.homeShopId).toBeNull();expect(admin.accessType).toBe('ADMIN');
    expect(admin.loginAccount).toEqual({id:3n,name:account.name,loginName:account.loginName,email:null,status:'ACTIVE'});
    for(const key of ['studioProfile','reviewComment','reviewedBy','deletedAt','loginBinding','incomingAccountGrants'])expect(admin).not.toHaveProperty(key);
    expect(findMany.mock.calls[0][0]).toHaveProperty('select.studioProfile',true);
    expect(findMany.mock.calls[0][0]).not.toHaveProperty('include');
    const [associated]=await service.getMyShops('4','MERCHANT');
    expect(associated.accessType).toBe('ASSOCIATED');expect(associated.homeShopId).toBe('72');
    expect(associated.loginAccount).toBeNull();expect(associated.permissions).toEqual(['CATALOG_MANAGE']);
    row.incomingAccountGrants[0].permissions=['COPY_CONFIG'];
    const [copyOnly]=await service.getMyShops('4','MERCHANT');
    expect(copyOnly).toMatchObject({id:71n,name:'Synthetic shop',status:'APPROVED',timezone:'America/Los_Angeles',permissions:['COPY_CONFIG']});
    for(const key of ['ownerId','phone','address','city','state','zipCode','latitude','longitude','studioProfile','shopServices','media','priceMenu','logoUrl','gallery'])expect(copyOnly).not.toHaveProperty(key);
  });
  test('COPY_CONFIG-only association cannot be reused as profile, catalog, booking, reservation, finance or owner access', async () => {
    const db:any={
      user:{findFirst:async()=>({id:4n})},
      shop:{findFirst:async()=>({id:71n,status:'APPROVED',deletedAt:null,owner:{},loginBinding:{userId:3n,user:{role:'MERCHANT',status:'ACTIVE',deletedAt:null}}})},
      shopAccountGrant:{findFirst:async()=>({sourceShopId:72n,permissions:['COPY_CONFIG']})},
    };
    await expect(requireShopAccess(db,71n,{id:'4',role:'MERCHANT'},'COPY_CONFIG')).resolves.toMatchObject({accessType:'ASSOCIATED',permissions:['COPY_CONFIG']});
    for(const permission of ['SHOP_SETTINGS_MANAGE','CATALOG_MANAGE','BOOKINGS_READ','RESERVATION_CONFIG','FINANCE_READ','OWNER_ONLY'] as const){
      await expect(requireShopAccess(db,71n,{id:'4',role:'MERCHANT'},permission)).rejects.toThrow();
    }
  });
  test('scalar whitelist rejects nested Prisma writes and foreign identifiers', () => {
    expect(() => scalarData({ shop: { update: { owner: { update: { role: 'ADMIN' } } } } }, ['name'])).toThrow('Unsupported field');
    expect(() => scalarData({ name: { set: 'Injected' } }, ['name'])).toThrow('Unsupported field');
    expect(() => scalarData({ shopId: '42' }, ['name'])).toThrow('Unsupported field');
    expect(scalarData({ name: 'Allowed', unused: undefined }, ['name', 'unused'])).toEqual({ name: 'Allowed' });
  });

  test('feature flags disable only explicit false and preserve legacy shops', () => {
    expect(shopFeatures(null)).toEqual({ onlineBooking: true, reviews: true });
    expect(shopFeatures({ features: { onlineBooking: false, reviews: false } })).toEqual({ onlineBooking: false, reviews: false });
    expect(shopFeatures('{"features":{"reviews":false}}')).toEqual({ onlineBooking: true, reviews: false });
  });

  test('booking local fields use the snapshot before the current shop timezone and mark unknown legacy zones', () => {
    const booking = { startTime: new Date('2031-01-15T15:00:00Z'), endTime: new Date('2031-01-15T16:00:00Z'), bookingTimezone: 'America/New_York' };
    expect(bookingLocalFields(booking, 'Europe/London')).toEqual({ timezone: 'America/New_York', localDate: '2031-01-15', localStartTime: '10:00', localEndTime: '11:00' });
    expect(bookingLocalFields({ ...booking, bookingTimezone: null }, 'America/New_York').localStartTime).toBe('10:00');
    expect(bookingLocalFields({ ...booking, bookingTimezone: 'Invalid/Zone' }, 'America/New_York').localStartTime).toBe('10:00');
    expect(bookingLocalFields({ ...booking, bookingTimezone: null })).toEqual({ timezone: null, localDate: null, localStartTime: null, localEndTime: null });
  });

  test('real providers cannot accept payment without an explicit valid refund policy', () => {
    const keys = ['PAYMENT_PROVIDER', 'REFUND_POLICY_FULL_HOURS', 'REFUND_POLICY_PARTIAL_PERCENT', 'BOOKING_ONLINE_PAYMENT_ENABLED'] as const;
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      const payment = new PaymentService({} as any) as any;
      payment.square = { config: () => ({ enabled: true, provider: 'square' }) };
      process.env.BOOKING_ONLINE_PAYMENT_ENABLED = 'true';
      process.env.PAYMENT_PROVIDER = 'square'; delete process.env.REFUND_POLICY_FULL_HOURS; delete process.env.REFUND_POLICY_PARTIAL_PERCENT;
      expect(payment.config().enabled).toBe(false);
      process.env.REFUND_POLICY_FULL_HOURS = '24'; process.env.REFUND_POLICY_PARTIAL_PERCENT = '101';
      expect(payment.config().enabled).toBe(false);
      process.env.REFUND_POLICY_PARTIAL_PERCENT = '50'; expect(payment.config().enabled).toBe(true);
    } finally { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
  });

  test('private FCM notifications never use subscribable topics or collide large user IDs', async () => {
    const original = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    try {
      const ids: bigint[] = [];
      const fcm = new FcmService({ pushDevice: {
        findMany: async ({ where }: any) => { ids.push(where.userId); return where.userId === 9007199254740992n ? [{ id: 'one', bindingVersion: 'version', token: 'device-a' }] : []; },
        findFirst: async () => ({ id: 'one', bindingVersion: 'version', token: 'device-a' }),
      } } as any) as any;
      const sent: any[] = [];
      fcm.isConfigured = true;
      fcm.admin = { messaging: () => ({ send: async (message: any) => { sent.push(message); return 'sent'; } }) };
      expect(await fcm.sendToUser('9007199254740993', 'private', 'private')).toEqual({ error: 'NO_REGISTERED_DEVICE' });
      expect(sent).toHaveLength(0);
      await fcm.sendToUser('9007199254740992', 'a', 'a');
      await fcm.sendToUser('9007199254740993', 'b', 'b');
      expect(sent.map(x => x.token)).toEqual(['device-a']);
      expect(sent.every(x => !('topic' in x))).toBe(true);
      expect(ids).toEqual([9007199254740993n, 9007199254740992n, 9007199254740993n]);
      await expect(fcm.sendToUser(Number.MAX_SAFE_INTEGER + 1, 'a', 'a')).rejects.toThrow('Invalid user identity');
    } finally { if (original === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH; else process.env.FIREBASE_SERVICE_ACCOUNT_PATH = original; }
  });

  test('legacy direct-upload and HEAD-only avatar confirmation cannot bypass image decoding', async () => {
    const update = jest.fn(async () => ({}));
    const service = new UploadService({ user: { update } } as any);
    expect(() => service.generateAvatarPresignedUrl('1', 'png')).toThrow('DIRECT_UPLOAD_DISABLED');
    expect(() => service.confirmAvatar('1', 'https://images.example.invalid/avatars/1/test.png')).toThrow('DIRECT_AVATAR_CONFIRM_DISABLED');
    expect(update).not.toHaveBeenCalled();
  });

  test('Studio contacts can be cleared, valid email and phone are required when provided', async () => {
    const studio = new StudioService({} as any) as any;
    const actor = { id: '1', role: 'ADMIN' };
    const input = (key: string, value: unknown) => studio.data({}, 'settings', { value }, { key }, actor);
    expect(await input('support_email', '')).toEqual({ value: '' });
    expect(await input('support_phone', '')).toEqual({ value: '' });
    await expect(input('site_name', '')).rejects.toThrow('Invalid value');
    await expect(input('support_email', 'invalid')).rejects.toThrow('Invalid support email');
    await expect(input('support_phone', '123')).rejects.toThrow('7–15 digits');
    expect(await input('support_email', 'support@example.invalid')).toEqual({ value: 'support@example.invalid' });
    expect(await input('support_phone', '+1 (212) 555-0100')).toEqual({ value: '+1 (212) 555-0100' });
    const newStore = await studio.data({ shopLoginBinding:{findUnique:async()=>null}, $queryRaw: jest.fn(async () => []), user: { findFirst: async () => ({ id: 2n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName: 'synthetic-merchant', passwordHash: '$2b$10$' + 'a'.repeat(53) }) } }, 'stores', { ownerId: '2', name: 'New draft store', shortName: 'new-draft-store' }, undefined, actor);
    expect(newStore.studioProfile.features.onlineBooking).toBe(false);
  });
});
