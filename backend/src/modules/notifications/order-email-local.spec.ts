import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrderEmailDelivery, orderEmailConfig } from './order-email-delivery';

const id = '00000000-0000-4000-8000-000000000021';
const message = { recipient: 'guest+local@example.test', subject: 'Booking order MJ_LOCAL', text: 'Whole-order total: $80.00\nHandle offline.' };
const keys = ['NODE_ENV','ORDER_EMAIL_ENABLED','ORDER_EMAIL_PROVIDER','ORDER_EMAIL_LOCAL_CAPTURE','ORDER_EMAIL_LOCAL_CAPTURE_DIR'];
let oldEnv: Record<string, string | undefined>, directory: string;
beforeEach(async () => {
  oldEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  directory = await mkdtemp(join(tmpdir(), 'massajoy-order-email-'));
  Object.assign(process.env, { NODE_ENV: 'test', ORDER_EMAIL_ENABLED: 'true', ORDER_EMAIL_PROVIDER: 'local', ORDER_EMAIL_LOCAL_CAPTURE: 'true', ORDER_EMAIL_LOCAL_CAPTURE_DIR: directory });
});
afterEach(async () => {
  for (const key of keys) if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
  await rm(directory, { recursive: true, force: true });
});

describe('safe local order email acceptance', () => {
  test('requires two explicit opt-ins and cannot run in production', async () => {
    expect(orderEmailConfig()).toMatchObject({ enabled: true, provider: 'local', deliveryMode: 'LOCAL_CAPTURE', acceptanceIsDelivery: false });
    for (const change of [{ ORDER_EMAIL_ENABLED: 'false' }, { ORDER_EMAIL_LOCAL_CAPTURE: 'false' }, { NODE_ENV: 'production' }]) {
      expect(orderEmailConfig({ ...process.env, ...change })).toMatchObject({ enabled: false, provider: null, reasonCode: 'ORDER_EMAIL_NOT_CONFIGURED' });
    }
    process.env.NODE_ENV = 'production';
    expect(await new OrderEmailDelivery().send(message, id)).toMatchObject({ status: 'BLOCKED', code: 'ORDER_EMAIL_NOT_CONFIGURED' });
    expect(await readdir(directory)).toEqual([]);
  });
  test('writes a reviewable capture and bypasses the external transport entirely', async () => {
    const external = jest.fn(async () => { throw Error('External transport must never run'); });
    const delivery = new OrderEmailDelivery(external);
    expect(await delivery.send(message, id)).toEqual({ status: 'ACCEPTED', code: null, accepted: 1 });
    expect(external).not.toHaveBeenCalled();
    const capture = JSON.parse(await readFile(join(directory, id + '.json'), 'utf8'));
    expect(capture).toMatchObject({ ...message, outboxId: id, deliveryMode: 'LOCAL_CAPTURE', externalDelivery: false, idempotencyKey: 'booking-order/' + id });
    expect(Number.isFinite(Date.parse(capture.capturedAt))).toBe(true);
    expect(await readdir(directory)).toEqual([id + '.json']);
  });
  test('retries the exact durable key without duplicate captures and rejects changed content', async () => {
    const delivery = new OrderEmailDelivery();
    const result = await delivery.send(message, id), original = await readFile(join(directory, id + '.json'), 'utf8');
    expect(await delivery.send({ ...message }, id)).toEqual(result);
    expect(await readFile(join(directory, id + '.json'), 'utf8')).toBe(original);
    expect(await delivery.send({ ...message, text: 'Different order' }, id)).toMatchObject({ status: 'BLOCKED', code: 'ORDER_EMAIL_PROVIDER_REJECTED' });
    expect(await readdir(directory)).toEqual([id + '.json']);
  });
  test('invalid identifiers or recipients do not write files', async () => {
    const delivery = new OrderEmailDelivery();
    expect(await delivery.send(message, '../outside')).toMatchObject({ status: 'BLOCKED' });
    expect(await delivery.send({ ...message, recipient: 'not-an-email' }, id)).toMatchObject({ status: 'BLOCKED' });
    expect(await readdir(directory)).toEqual([]);
  });
});
