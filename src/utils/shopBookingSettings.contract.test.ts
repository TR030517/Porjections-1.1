import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkedShopBookingSettings, closureAnnouncement, noticeInputMinutes, shopBookingDate } from './shopBookingSettings';
import { isShopClosedOnDate, meetsShopBookingNotice, normalizeShopBookingSettings, shopBookingNoticeCutoff } from '../../backend/src/common/shop-booking-settings';

test('editable booking rules and the server use the same minute limits and canonical calendar ranges', () => {
  for (const minutes of [0, 1, 29, 30, 720, 1440, 10080]) {
    const draft = { minimumNoticeMinutes: noticeInputMinutes(String(minutes / 60), 60), closedPeriods: [
      { startDate: '2028-02-29', endDate: '2028-03-01' },
      { startDate: '2026-12-31', endDate: '2027-01-02' },
    ] };
    const sent = checkedShopBookingSettings(draft), saved = normalizeShopBookingSettings(JSON.parse(JSON.stringify(sent)));
    assert.equal(saved.minimumNoticeMinutes, minutes);
    assert.deepEqual(saved, sent);
    assert.deepEqual(checkedShopBookingSettings(saved), sent, 'the save receipt is accepted without a second representation');
    assert.equal(draft.closedPeriods[0].startDate, '2028-02-29', 'validation never reorders the editable draft in place');
  }
  for (const invalid of [
    { minimumNoticeMinutes: -1, closedPeriods: [] }, { minimumNoticeMinutes: 10081, closedPeriods: [] },
    { minimumNoticeMinutes: 0.5, closedPeriods: [] },
    { minimumNoticeMinutes: 0, closedPeriods: [{ startDate: '2027-02-29', endDate: '2027-03-01' }] },
    { minimumNoticeMinutes: 0, closedPeriods: [{ startDate: '2026-11-20', endDate: '2026-11-11' }] },
    { minimumNoticeMinutes: 0, closedPeriods: [{ startDate: '2026-11-11', endDate: '2026-11-20' }, { startDate: '2026-11-20', endDate: '2026-11-21' }] },
  ]) {
    assert.throws(() => checkedShopBookingSettings(invalid));
    assert.throws(() => normalizeShopBookingSettings(invalid));
  }
});

test('a twelve-hour UI policy preserves elapsed time across DST and includes the exact future threshold', () => {
  const settings = normalizeShopBookingSettings(checkedShopBookingSettings({ minimumNoticeMinutes: noticeInputMinutes('12', 60), closedPeriods: [] }));
  const now = new Date('2026-11-01T08:30:00Z'); // 01:30 PDT before the repeated hour.
  const cutoff = shopBookingNoticeCutoff(settings, now);
  assert.equal(new Date(cutoff).toISOString(), '2026-11-01T20:30:00.000Z');
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(cutoff), '12:30');
  assert.equal(meetsShopBookingNotice(settings, new Date(cutoff - 1), now), false);
  assert.equal(meetsShopBookingNotice(settings, new Date(cutoff), now), true);
  const zero = normalizeShopBookingSettings({ minimumNoticeMinutes: 0, closedPeriods: [] });
  assert.equal(meetsShopBookingNotice(zero, now, now), false, 'zero notice still requires a future start');
  assert.equal(meetsShopBookingNotice(zero, new Date(+now + 1), now), true);
});

test('closed ranges include both local calendar endpoints without using a guest or machine date', () => {
  const period = { startDate: '2026-12-31', endDate: '2027-01-02' };
  const settings = normalizeShopBookingSettings(checkedShopBookingSettings({ minimumNoticeMinutes: 0, closedPeriods: [period] }));
  for (const [instant, expected] of [
    ['2026-12-31T07:59:59.999Z', false], ['2026-12-31T08:00:00Z', true],
    ['2027-01-03T07:59:59.999Z', true], ['2027-01-03T08:00:00Z', false],
  ] as const) {
    assert.equal(isShopClosedOnDate(settings, shopBookingDate('America/Los_Angeles', new Date(instant))), expected);
  }
  const sameInstant = new Date('2027-01-03T08:00:00Z');
  assert.equal(isShopClosedOnDate(settings, shopBookingDate('Pacific/Honolulu', sameInstant)), true);
  assert.equal(isShopClosedOnDate(settings, shopBookingDate('America/Los_Angeles', sameInstant)), false);
  assert.equal(closureAnnouncement(period, '202-555-0144'), 'Closed from Dec 31, 2026 to Jan 2, 2027. For questions, contact the shop: 202-555-0144');
});
