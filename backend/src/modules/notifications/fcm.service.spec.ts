import { FcmService } from './fcm.service';

describe('FCM disabled-provider and input boundaries without Firebase calls', () => {
  const saved = { enabled: process.env.FCM_ENABLED, path: process.env.FIREBASE_SERVICE_ACCOUNT_PATH };
  beforeEach(() => { delete process.env.FCM_ENABLED; delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH; });
  afterAll(() => {
    for (const [name, value] of [['FCM_ENABLED', saved.enabled], ['FIREBASE_SERVICE_ACCOUNT_PATH', saved.path]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
  });
  test('disabled delivery does not query a database or fabricate provider success', async () => {
    const service = new FcmService({} as any);
    expect(service.config()).toEqual({ enabled: false, provider: 'fcm', reason: 'PUSH_NOT_CONFIGURED' });
    expect(await service.sendToUser('1', 'private', 'private')).toEqual({ error: 'PUSH_NOT_CONFIGURED' });
  });
  test('a path alone does not enable Firebase', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = 'does-not-exist.json';
    expect(new FcmService({} as any).config().enabled).toBe(false);
  });
  test('explicit enable without a readable credential file remains disabled', () => {
    process.env.FCM_ENABLED = 'true';
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = 'does-not-exist.json';
    expect(new FcmService({} as any).config()).toEqual({ enabled: false, provider: 'fcm', reason: 'PUSH_NOT_CONFIGURED' });
  });
  test('internal registration callers cannot bypass session and token validation', async () => {
    const service = new FcmService({} as any);
    await expect(service.registerToken('1', '', 'token')).rejects.toThrow('valid login session');
    await expect(service.registerToken('1', '12345678-1234-1234-1234-123456789012', 'has space')).rejects.toThrow('Invalid device token');
    await expect(service.registerToken('1', '12345678-1234-1234-1234-123456789012', 42 as any)).rejects.toThrow('Invalid device token');
    await expect(service.registerToken('9223372036854775808', '12345678-1234-1234-1234-123456789012', 'token')).rejects.toThrow('Invalid user identity');
  });
});
