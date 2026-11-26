import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWeeklyBusinessHours, weeklyScheduleFit, type WeeklyScheduleTherapist } from './weeklySchedule';

const hours = (value: unknown) => {
  const result = parseWeeklyBusinessHours(value); assert.ok(result); return result;
};
const custom = (id: string, shifts: Array<[number, number, number]>): WeeklyScheduleTherapist => ({
  id, scheduleMode: 'CUSTOM', shifts: shifts.map(([weekday, startMin, endMin]) => ({ weekday, startMin, endMin, isActive: true })),
});
const shop = (id: string): WeeklyScheduleTherapist => ({ id, scheduleMode: 'SHOP', shifts: [] });
function fit(overrides: Partial<Parameters<typeof weeklyScheduleFit>[0]> = {}) {
  return weeklyScheduleFit({ periods: hours({ monday: { open: '09:00', close: '17:00' } }), durationMin: 60, staffBufferMin: 0, requiredStaffCount: 1, therapists: [shop('1')], ...overrides });
}

test('canonical hours preserve backend closed/missing-day and adjacent-period semantics', () => {
  assert.equal(parseWeeklyBusinessHours(undefined), null);
  assert.deepEqual(parseWeeklyBusinessHours({}), []);
  assert.deepEqual(parseWeeklyBusinessHours(JSON.stringify({ monday: { open: '09:00', close: '10:00' } })), [{ weekday: 1, startMin: 540, endMin: 600 }]);
  assert.deepEqual(parseWeeklyBusinessHours({ monday: { closed: true, open: 'ignored', close: 'ignored' }, tuesday: false }), []);
  assert.deepEqual(hours({ monday: [{ open: '10:00', close: '11:00' }, { open: '09:00', close: '10:00' }] }), [
    { weekday: 1, startMin: 540, endMin: 600 }, { weekday: 1, startMin: 600, endMin: 660 },
  ]);
  for (const value of [
    'not an hours object', { Monday: { open: '09:00', close: '17:00' } }, { monday: { open: true, start: '09:00', end: '17:00' } },
    { monday: { open: '09:00', close: '24:00' } }, { monday: { closed: 'true' } }, { monday: { open: '17:00', close: '09:00' } },
    { monday: [{ open: '09:00', close: '11:00' }, { open: '10:00', close: '12:00' }] }, { monday: Array.from({ length: 5 }, () => ({ closed: true })) },
  ]) assert.equal(parseWeeklyBusinessHours(value), null);
});

test('two qualified staff need the same weekly window, rather than unrelated valid shifts', () => {
  const periods = hours({ monday: { open: '09:00', close: '12:00' }, tuesday: { open: '09:00', close: '12:00' } });
  for (const therapists of [
    [custom('1', [[1, 540, 600]]), custom('2', [[2, 540, 600]])],
    [custom('1', [[1, 540, 600]]), custom('2', [[1, 600, 660]])],
    [custom('1', [[1, 540, 630]]), custom('2', [[1, 600, 690]])],
  ]) assert.deepEqual(fit({ periods, therapists, requiredStaffCount: 2 }), { hasServiceWindow: true, hasStaffCoverage: false, withoutShiftIds: [] });
  assert.equal(fit({ periods, therapists: [custom('1', [[1, 540, 660]]), custom('2', [[1, 570, 660]])], requiredStaffCount: 2 }).hasStaffCoverage, true);
});

test('SHOP needs its inherited hours to cover the staff buffer; CUSTOM may finish after closing', () => {
  const periods = hours({ monday: { open: '09:00', close: '10:00' } });
  assert.equal(fit({ periods, staffBufferMin: 15 }).hasStaffCoverage, false);
  assert.equal(fit({ periods, staffBufferMin: 15, therapists: [custom('1', [[1, 540, 615]])] }).hasStaffCoverage, true);
  assert.equal(fit({ periods, staffBufferMin: 15, therapists: [{ ...shop('1'), shifts: custom('unused', [[1, 540, 615]]).shifts }] }).hasStaffCoverage, false, 'personal shifts do not extend SHOP mode');
});

test('CUSTOM coverage stitches adjacent shifts and follows legal buffers across midnight and the week boundary', () => {
  for (const [weekday, nextDay, key] of [[1, 2, 'monday'], [6, 0, 'saturday']] as const) {
    const periods = hours({ [key]: { open: '23:00', close: '23:59' } });
    assert.equal(fit({ periods, durationMin: 30, staffBufferMin: 60, therapists: [custom('1', [[weekday, 1380, 1440], [nextDay, 0, 30]])] }).hasStaffCoverage, true);
    assert.equal(fit({ periods, durationMin: 30, staffBufferMin: 60, therapists: [custom('1', [[weekday, 1380, 1440], [nextDay, 1, 31]])] }).hasStaffCoverage, false, 'even a one-minute gap cannot cover occupation');
  }
  assert.equal(fit({ durationMin: 120, therapists: [custom('1', [[1, 540, 600], [1, 600, 660]])] }).hasStaffCoverage, true);
  assert.equal(fit({ durationMin: 120, therapists: [custom('1', [[1, 540, 600], [1, 601, 660]])] }).hasStaffCoverage, false);
});

test('service duration cannot bridge lunch or adjacent opening periods even when staff coverage is continuous', () => {
  for (const periods of [
    hours({ monday: [{ open: '09:00', close: '10:00' }, { open: '11:00', close: '12:00' }] }),
    hours({ monday: [{ open: '09:00', close: '10:00' }, { open: '10:00', close: '11:00' }] }),
  ]) assert.equal(fit({ periods, durationMin: 90, therapists: [custom('1', [[1, 540, 720]])] }).hasServiceWindow, false);
});

test('candidate starts use each opening time as the thirty-minute grid origin', () => {
  const periods = hours({ monday: { open: '09:10', close: '11:10' } });
  assert.equal(fit({ periods, therapists: [custom('1', [[1, 560, 620]])] }).hasStaffCoverage, false, '09:20 has an hour of coverage but is not a legal start');
  assert.equal(fit({ periods, therapists: [custom('1', [[1, 580, 640]])] }).hasStaffCoverage, true, '09:40 is on the opening-period grid');
});

test('legacy missing mode is CUSTOM, invalid weekdays fail closed, and duplicate staff never meet a two-person requirement', () => {
  const legacy = { ...custom('1', [[1, 540, 600]]), scheduleMode: undefined };
  assert.equal(fit({ therapists: [legacy] }).hasStaffCoverage, true);
  for (const therapist of [{ ...legacy, shifts: [] }, { ...legacy, scheduleMode: 'UNKNOWN' }, custom('1', [[7, 540, 600]]), custom('1', [[1, 540.5, 600]])]) {
    assert.deepEqual(fit({ therapists: [therapist] }).withoutShiftIds, ['1']);
    assert.equal(fit({ therapists: [therapist] }).hasStaffCoverage, false);
  }
  assert.equal(fit({ therapists: [shop('1'), shop('1')], requiredStaffCount: 2 }).hasStaffCoverage, false);
  assert.equal(fit({ therapists: [shop('1'), shop('2'), { ...legacy, id: '3', shifts: [] }], requiredStaffCount: 2 }).hasStaffCoverage, true, 'unused staff with missing shifts do not block an otherwise feasible team');
});

test('invalid or missing staff buffer is never interpreted as zero', () => {
  for (const staffBufferMin of [undefined, -1, 121, 1.5, Number.NaN]) assert.equal(fit({ staffBufferMin: staffBufferMin as number }).hasStaffCoverage, false);
  assert.equal(fit({ periods: [], staffBufferMin: 0 }).hasServiceWindow, false);
});
