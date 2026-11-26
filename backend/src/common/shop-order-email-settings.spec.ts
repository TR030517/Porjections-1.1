import { shopOrderEmailSettingsView, verifiedShopOrderEmailRecipient } from './shop-order-email-settings';

const delivery = { configured: false, mode: null, workerEnabled: true, reasonCode: 'ORDER_EMAIL_NOT_CONFIGURED' } as const;
const now = new Date('2030-01-01T00:00:00Z');
const setting = () => ({ revision: 3, enabled: true, recipientEmail: 'private+orders@example.test', recipientVerifiedAt: new Date('2029-01-01T00:00:00Z') });

describe('private store recipient proof and public-contact separation', () => {
  test('valid public syntax is explicitly legacy unverified, not a verified recipient', () => {
    const view = shopOrderEmailSettingsView(null, { emails: ['bad', 'Public@Example.test'] }, 10n, delivery, now);
    expect(view).toMatchObject({ shopId: '10', revision: 0, state: 'LEGACY_UNVERIFIED', recipient: null, verifiedAt: null, legacyCandidate: 'public@example.test', pending: null });
    expect(verifiedShopOrderEmailRecipient({ emails: ['public@example.test'] })).toBeNull();
    expect(shopOrderEmailSettingsView(null, { emails: [] }, '10', delivery, now).state).toBe('MISSING');
  });
  test.each([null, {}, { ...setting(), enabled: false }, { ...setting(), enabled: 'true' }, { ...setting(), recipientVerifiedAt: null },
    { ...setting(), recipientVerifiedAt: '2029-01-01' }, { ...setting(), recipientVerifiedAt: new Date(NaN) }, { ...setting(), recipientEmail: 'x\r\n@example.test' }])('unusable or partial proof fails closed %#', value => {
    expect(verifiedShopOrderEmailRecipient(value)).toBeNull();
  });
  test('verified recipient remains private and independent from public and login emails', () => {
    const row = { ...setting(), codeHash: 'secret', loginEmail: 'login@example.test' };
    const profile = { emails: ['public@example.test'] };
    expect(shopOrderEmailSettingsView(row, profile, 10n, delivery, now)).toMatchObject({ state: 'VERIFIED', recipient: 'private+orders@example.test', legacyCandidate: 'public@example.test', delivery });
    expect(profile).toEqual({ emails: ['public@example.test'] });
    expect(JSON.stringify(shopOrderEmailSettingsView(row, profile, 10n, delivery, now))).not.toContain('secret');
    expect(shopOrderEmailSettingsView({ ...row, recipientVerifiedAt: null }, profile, 10n, delivery, now).state).toBe('INVALID');
    expect(shopOrderEmailSettingsView({ ...row, enabled: false }, profile, 10n, delivery, now).state).toBe('DISABLED');
  });
  test('pending proof does not replace active recipient and expired/exhausted challenges disappear', () => {
    const row = { ...setting(), challengeId: '00000000-0000-4000-8000-000000000010', pendingEmail: 'next@example.test', codeHash: 'secret',
      pendingExpiresAt: new Date(now.getTime() + 1000), attempts: 2, deliveryState: 'UNKNOWN', consumedAt: null };
    const view = shopOrderEmailSettingsView(row, {}, 10n, delivery, now);
    expect(view.recipient).toBe('private+orders@example.test');
    expect(view.pending).toEqual({ challengeId: row.challengeId, email: row.pendingEmail, expiresAt: row.pendingExpiresAt.toISOString(), attemptsRemaining: 3, deliveryState: 'UNKNOWN' });
    expect(JSON.stringify(view)).not.toContain('secret');
    for (const change of [{ attempts: 5 }, { consumedAt: now }, { pendingExpiresAt: now }, { deliveryState: 'OTHER' }])
      expect(shopOrderEmailSettingsView({ ...row, ...change }, {}, 10n, delivery, now).pending).toBeNull();
  });
});
