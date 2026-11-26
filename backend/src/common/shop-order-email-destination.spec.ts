import { shopOrderEmailEventRecipient, verifiedShopOrderEmailEnvelope, SHOP_ORDER_EMAIL_DESTINATION_SELECT } from './shop-order-email-destination';
import { orderEmailRecipientFingerprint, readShopOrderEmailEnvelope, shopOrderEmailEnvelope } from './shop-order-email';

const verified = () => ({ enabled: true, recipientEmail: 'Private@example.test', recipientVerifiedAt: new Date('2026-11-18T00:00:00Z') });
const profile = { emails: ['legacy@example.test'] };
describe('versioned store-mail destinations', () => {
  test('v2 records only a fingerprint; no code, pending address or private recipient is serialized', () => {
    const envelope = verifiedShopOrderEmailEnvelope('10', verified(), null);
    expect(envelope).toEqual({ version: 2, audience: 'SHOP', shopId: '10', recipientFingerprint: orderEmailRecipientFingerprint('private@example.test'), snapshot: null });
    expect(readShopOrderEmailEnvelope(envelope)).toEqual(envelope);
    expect(JSON.stringify(envelope)).not.toContain('example.test');
    expect(Object.keys(SHOP_ORDER_EMAIL_DESTINATION_SELECT).sort()).toEqual(['enabled', 'recipientEmail', 'recipientVerifiedAt']);
  });
  test.each([null, { enabled: true }, { ...verified(), recipientVerifiedAt: null }, { ...verified(), recipientVerifiedAt: new Date(NaN) }, { ...verified(), enabled: false }])('v2 never falls back to public/login contacts for %p', setting => {
    const envelope = verifiedShopOrderEmailEnvelope('10', setting, null);
    expect(envelope.recipientFingerprint).toBeNull();
    expect(shopOrderEmailEventRecipient(envelope, { studioProfile: profile, orderEmailSetting: setting })).toBeNull();
  });
  test('historical v1 preserves exact five-key payload and pending-only legacy routing', () => {
    const envelope = shopOrderEmailEnvelope('10', profile, null), original = JSON.stringify(envelope);
    expect(envelope.version).toBe(1); expect(readShopOrderEmailEnvelope(original)).toEqual(envelope);
    expect(shopOrderEmailEventRecipient(envelope, { studioProfile: profile })).toBe('legacy@example.test');
    expect(shopOrderEmailEventRecipient(envelope, { studioProfile: profile, orderEmailSetting: { enabled: true, pendingEmail: 'pending@example.test' } })).toBe('legacy@example.test');
    expect(JSON.stringify(envelope)).toBe(original);
  });
  test('activation/disable never silently restores legacy routing from corrupt or partial proof', () => {
    const envelope = shopOrderEmailEnvelope('10', profile, null);
    expect(shopOrderEmailEventRecipient(envelope, { studioProfile: profile, orderEmailSetting: verified() })).toBe('private@example.test');
    for (const setting of [{ enabled: false }, { enabled: true, recipientEmail: 'bad' }, { enabled: true, recipientVerifiedAt: new Date() }, {}])
      expect(shopOrderEmailEventRecipient(envelope, { studioProfile: profile, orderEmailSetting: setting })).toBeNull();
  });
  test('strict parser accepts known versions and rejects extra recipient data/unknown versions', () => {
    const envelope = verifiedShopOrderEmailEnvelope('10', verified(), null);
    expect(readShopOrderEmailEnvelope({ ...envelope, recipient: 'injected@example.test' })).toBeNull();
    expect(readShopOrderEmailEnvelope({ ...envelope, version: 3 })).toBeNull();
  });
});
