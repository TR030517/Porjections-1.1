import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkedShopBookingSettings, closureAnnouncement, nextClosurePeriod, noticeInputMinutes, shopBookingDate } from './shopBookingSettings';

test('hours and days are presentation units; both preserve the same minute policy including fractional values', () => {
  assert.equal(noticeInputMinutes(12, 60), 720);
  assert.equal(noticeInputMinutes(0.5, 1440), 720);
  for (const minutes of [0, 1, 15, 45, 720, 1440, 10080]) {
    assert.equal(noticeInputMinutes(String(minutes / 60), 60), minutes);
    assert.equal(noticeInputMinutes(String(minutes / 1440), 1440), minutes);
  }
  for (const value of ['', ' ', null, -1, NaN, Infinity, 169, 0.001]) assert.throws(() => noticeInputMinutes(value, 60), /提前预约时间/);
});

test('closed calendar days validate real dates, inclusive overlaps and server canonical ordering', () => {
  const draft = { minimumNoticeMinutes: 720, closedPeriods: [{ startDate: '2028-02-29', endDate: '2028-03-01' }, { startDate: '2027-12-31', endDate: '2027-12-31' }] };
  const original = structuredClone(draft);
  assert.equal(checkedShopBookingSettings(draft).closedPeriods[0].startDate, '2027-12-31');
  assert.deepEqual(draft, original, 'validating never reorders the editable draft');
  for (const periods of [
    [{ startDate: '2027-02-29', endDate: '2027-03-01' }],
    [{ startDate: '2026-11-20', endDate: '2026-11-11' }],
    [{ startDate: '', endDate: '2026-11-11' }],
    [{ startDate: '2026-11-11', endDate: '2026-11-20' }, { startDate: '2026-11-20', endDate: '2026-11-21' }],
  ]) assert.throws(() => checkedShopBookingSettings({ minimumNoticeMinutes: 0, closedPeriods: periods }), /闭店/);
});

test('new closures use the shop calendar across UTC and daylight-saving boundaries, with no silent device fallback', () => {
  const now = new Date('2026-11-07T01:00:00Z');
  assert.equal(shopBookingDate('America/Los_Angeles', now), '2026-11-06');
  assert.equal(shopBookingDate('Asia/Tokyo', now), '2026-11-07');
  assert.deepEqual(nextClosurePeriod([], 'America/Los_Angeles', now), { startDate: '2026-11-07', endDate: '2026-11-07' });
  assert.deepEqual(nextClosurePeriod([], 'America/Los_Angeles', new Date('2026-11-01T08:30:00Z')), { startDate: '2026-11-02', endDate: '2026-11-02' });
  for (const timezone of [null, '', 'Unknown/Zone']) assert.throws(() => nextClosurePeriod([], timezone, now), /门店基本资料.*时区/);
});

test('adding a second closure chooses the next uncovered shop day rather than creating a duplicate unsavable row', () => {
  const now = new Date('2026-11-07T01:00:00Z');
  const periods = [{ startDate: '2026-11-08', endDate: '2026-11-10' }, { startDate: '2026-11-07', endDate: '2026-11-07' }];
  assert.deepEqual(nextClosurePeriod(periods, 'America/Los_Angeles', now), { startDate: '2026-11-11', endDate: '2026-11-11' });
  assert.throws(() => nextClosurePeriod([{ startDate: '', endDate: '2026-11-10' }], 'America/Los_Angeles', now), /闭店起止日期/);
});

test('English closure copy contains calendar years, inclusive ranges and the shop phone, independent of the device zone', () => {
  assert.equal(closureAnnouncement({ startDate: '2026-11-11', endDate: '2026-11-20' }, ' 202-555-0144 '), 'Closed from Nov 11, 2026 to Nov 20, 2026. For questions, contact the shop: 202-555-0144');
  assert.equal(closureAnnouncement({ startDate: '2026-12-31', endDate: '2027-01-02' }), 'Closed from Dec 31, 2026 to Jan 2, 2027. For questions, contact the shop.');
  assert.match(closureAnnouncement({ startDate: '2026-11-11', endDate: '2026-11-11' })!, /Closed on Nov 11, 2026/);
  assert.equal(closureAnnouncement({ startDate: '2026-11-20', endDate: '2026-11-11' }), null);
});
