import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ShopOrderEmailVerificationDelivery } from './shop-order-email-settings.delivery';

const id = '00000000-0000-4000-8000-000000000032', email = 'private+proof@example.test';
const keys = ['NODE_ENV', 'ORDER_EMAIL_ENABLED', 'ORDER_EMAIL_PROVIDER', 'ORDER_EMAIL_LOCAL_CAPTURE', 'ORDER_EMAIL_VERIFICATION_CAPTURE_DIR', 'ORDER_EMAIL_FROM', 'ORDER_EMAIL_API_KEY'];
let previous: Record<string, string | undefined>, directory: string;
beforeEach(async () => {
  previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  directory = await mkdtemp(join(tmpdir(), 'massajoy-private-email-proof-'));
  Object.assign(process.env, { NODE_ENV: 'test', ORDER_EMAIL_ENABLED: 'true', ORDER_EMAIL_PROVIDER: 'local', ORDER_EMAIL_LOCAL_CAPTURE: 'true', ORDER_EMAIL_VERIFICATION_CAPTURE_DIR: directory });
});
afterEach(async () => {
  for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  if (!resolve(directory).startsWith(resolve(tmpdir()) + '\\') && !resolve(directory).startsWith(resolve(tmpdir()) + '/')) throw Error('Unexpected temporary directory');
  await rm(directory, { recursive: true, force: true });
});

describe('separate booking recipient verification delivery', () => {
  test('local capture never calls external transport and has a separate purpose namespace', async () => {
    const external = jest.fn(async () => { throw Error('External transport must never run'); });
    const delivery = new ShopOrderEmailVerificationDelivery(external);
    expect(await delivery.send(email, '123456', id)).toBe('SENT'); expect(external).not.toHaveBeenCalled();
    const raw = await readFile(join(directory, id + '.json'), 'utf8'), captured = JSON.parse(raw);
    expect(captured).toMatchObject({ purpose: 'SHOP_ORDER_EMAIL_VERIFICATION', challengeId: id, idempotencyKey: 'shop-order-email-verification/' + id, recipient: email, externalDelivery: false, deliveryMode: 'LOCAL_CAPTURE' });
    expect(captured.text).toContain('123456'); expect(captured.text).toContain('does not sign you in');
    expect(await delivery.send(email, '123456', id)).toBe('SENT'); expect(await readFile(join(directory, id + '.json'), 'utf8')).toBe(raw);
    expect(await delivery.send('redirect@example.test', '123456', id)).toBe('FAILED'); expect(await readdir(directory)).toEqual([id + '.json']);
  });
  test('production rejects local capture and invalid addresses/IDs cannot create files', async () => {
    const delivery = new ShopOrderEmailVerificationDelivery();
    for (const args of [[email, '123456', '../outside'], ['x\r\n@example.test', '123456', id], [email, '12345', id]])
      expect(await delivery.send(...args as [string, string, string])).toBe('FAILED');
    process.env.NODE_ENV = 'production'; expect(await delivery.send(email, '123456', id)).toBe('FAILED');
    expect(await readdir(directory)).toEqual([]);
  });
  test.each([200, 429, 400, 500])('provider %s is classified without exposing diagnostics or retrying', async status => {
    Object.assign(process.env, { ORDER_EMAIL_PROVIDER: 'resend', ORDER_EMAIL_FROM: 'sender@example.test', ORDER_EMAIL_API_KEY: 'synthetic-key-only' });
    const transport = jest.fn(async (_message, key, _signal) => { expect(key).toBe('shop-order-email-verification/' + id); return { status, acceptedId: status === 200 ? 'synthetic-accepted' : null }; });
    expect(await new ShopOrderEmailVerificationDelivery(transport).send(email, '123456', id)).toBe(status === 200 ? 'SENT' : status >= 500 ? 'UNKNOWN' : 'FAILED');
    expect(transport).toHaveBeenCalledTimes(1); expect(await readdir(directory)).toEqual([]);
  });
  test('timeout and malformed success remain acceptance-unknown, never blindly retried', async () => {
    Object.assign(process.env, { ORDER_EMAIL_PROVIDER: 'resend', ORDER_EMAIL_FROM: 'sender@example.test', ORDER_EMAIL_API_KEY: 'synthetic-key-only' });
    const never = jest.fn(async () => new Promise<{ status: number; acceptedId: string | null }>(() => {}));
    expect(await new ShopOrderEmailVerificationDelivery(never).send(email, '123456', id, 5)).toBe('UNKNOWN'); expect(never).toHaveBeenCalledTimes(1);
    const malformed = jest.fn(async () => ({ status: 200, acceptedId: null }));
    expect(await new ShopOrderEmailVerificationDelivery(malformed).send(email, '123456', id)).toBe('UNKNOWN'); expect(malformed).toHaveBeenCalledTimes(1);
  });
});
