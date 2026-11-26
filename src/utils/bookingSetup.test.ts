import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingSetupIssues, type BookingSetupConfig } from './bookingSetup';
function fixture(): BookingSetupConfig {
  return { shopId: '5', timezone: 'America/Chicago', businessHours: { monday: { open: '09:00', close: '17:00' } }, services: [{ id: '7', name: 'Four hands', isActive: true, durationMin: 15, priceCents: 0, participantCount: 1, requiredStaffCount: 2, requiredRoomType: 'SINGLE', staffBufferMin: 0, variants: [{ durationMin: 60, priceCents: 12000, isActive: true, currency: 'usd' }] }],
    therapists: [1, 2].map(id => ({ id: String(id), name: id === 1 ? 'Alice' : 'Bob', isActive: true, serviceIds: ['7'], scheduleMode: 'SHOP', shifts: [] })), rooms: [{ isActive: true, roomType: 'SINGLE', capacity: 1 }] };
}

test('a missing timezone opens basic store information while hours remain a separate prerequisite', () => {
  const config = fixture(); config.timezone = null; config.businessHours = {};
  const issues = bookingSetupIssues(config, ['7']);
  assert.deepEqual(issues.map(issue => [issue.key, issue.kind, issue.action]), [
    ['timezone', 'timezone', '设置门店时区'], ['business-hours', 'hours', '完善营业设置'],
  ]);
});
test('saved four-hand setup uses its valid variant, two distinct SHOP therapists and room capacity for one guest', () => {
  const config = fixture();
  assert.deepEqual(bookingSetupIssues(config, ['7']), []);
  config.therapists[1].id = '1';
  assert.equal(bookingSetupIssues(config, ['7']).some(issue => issue.kind === 'staff'), true);
});
test('new project guidance reports inactive staffing and couple room capacity, regardless of legacy project links', () => {
  const config = fixture(); config.services[0].participantCount = 2; config.services[0].requiredRoomType = 'COUPLE'; config.therapists[1].serviceIds = []; config.therapists[1].isActive = false;
  const before = JSON.stringify(config);
  const issues = bookingSetupIssues(config, ['7']);
  assert.deepEqual(issues.map(issue => [issue.kind, issue.serviceId]), [['staff', '7'], ['room', '7']]);
  assert.equal(JSON.stringify(config), before);
});

test('couple appointments need two staff but can use the store schedule without any room', () => {
  const config = fixture();
  Object.assign(config.services[0], { participantCount: 2, requiredStaffCount: 2, requiredRoomType: null });
  config.rooms = [];
  const before = structuredClone(config);
  assert.deepEqual(bookingSetupIssues(config, ['7']), []);
  assert.deepEqual(config, before);
  config.therapists[1].isActive = false;
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['staff']);
  config.therapists[1].isActive = true;
  config.services[0].requiredStaffCount = 1;
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['service']);
});

test('explicit couple rooms require an active matching resource with capacity for both guests', () => {
  const config = fixture();
  Object.assign(config.services[0], { participantCount: 2, requiredStaffCount: 2, requiredRoomType: 'COUPLE' });
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['room']);
  config.rooms = [{ isActive: true, roomType: 'COUPLE', capacity: 2 }];
  assert.deepEqual(bookingSetupIssues(config, ['7']), []);
  config.rooms[0].isActive = false;
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['room']);
  Object.assign(config.rooms[0], { isActive: true, capacity: 1 });
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['room']);
  config.services[0].requiredRoomType = 'SINGLE';
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['service']);
});

test('single-guest and foot-seat requests retain optional resource checks and reject invalid room types', () => {
  const config = fixture();
  config.services[0].requiredRoomType = 'FOOT_SEAT';
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['room']);
  config.rooms = [{ isActive: true, roomType: 'FOOT_SEAT', capacity: 1 }];
  assert.deepEqual(bookingSetupIssues(config, ['7']), []);
  config.services[0].requiredRoomType = 'UNKNOWN';
  config.rooms = [{ isActive: true, roomType: 'UNKNOWN', capacity: 1 }];
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['service']);
});
test('paused parents and CUSTOM without shifts never produce a ready configuration summary', () => {
  const config = fixture(); config.services[0].isActive = false;
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['activation']);
  config.services[0].isActive = true; config.therapists[0].scheduleMode = 'CUSTOM';
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['schedule']);
});

test('missing, invalid and fully closed canonical hours always produce an hours issue', () => {
  for (const businessHours of [undefined, {}, { monday: { closed: true } }, { Monday: { open: '09:00', close: '17:00' } }, { monday: { open: true, start: '09:00', end: '17:00' } }]) {
    const config = fixture(); config.businessHours = businessHours;
    assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['hours']);
  }
  const config = fixture(); config.businessHours = { monday: { open: '09:00', close: '09:30' } };
  const issues = bookingSetupIssues(config, ['7']);
  assert.deepEqual(issues.map(issue => [issue.kind, issue.serviceId]), [['hours', '7']], 'an unused 15-minute base must not rescue the active 60-minute variant');
});

test('two valid CUSTOM schedules on different weekdays are not a jointly feasible team', () => {
  const config = fixture(); config.businessHours = { monday: { open: '09:00', close: '12:00' }, tuesday: { open: '09:00', close: '12:00' } };
  config.therapists.forEach((therapist, index) => { therapist.scheduleMode = 'CUSTOM'; therapist.shifts = [{ weekday: index + 1, startMin: 540, endMin: 660, isActive: true }]; });
  const before = JSON.stringify(config), issues = bookingSetupIssues(config, ['7']);
  assert.deepEqual(issues.map(issue => [issue.kind, issue.therapistId]), [['schedule', '1']]);
  assert.match(issues[0].message, /Alice.*Bob.*共同接待/);
  assert.equal(JSON.stringify(config), before, 'the precheck never rewrites schedules or mode');
});

test('missing or invalid shifts locate the active store technician rather than an inactive first row', () => {
  for (const shifts of [[], [{ weekday: 7, startMin: 540, endMin: 660, isActive: true }]]) {
    const config = fixture(); config.therapists[1].scheduleMode = 'CUSTOM'; config.therapists[1].shifts = shifts;
    config.therapists.unshift({ id: '99', name: 'Inactive first row', isActive: false, serviceIds: [], scheduleMode: 'CUSTOM', shifts: [] });
    const issues = bookingSetupIssues(config, ['7']);
    assert.deepEqual(issues.map(issue => [issue.kind, issue.therapistId]), [['schedule', '2']]);
    assert.match(issues[0].message, /Bob/); assert.doesNotMatch(issues[0].message, /Inactive/);
  }
});

test('staff buffer distinguishes an impossible SHOP template from legal CUSTOM cleanup after closing', () => {
  const config = fixture(); config.businessHours = { monday: { open: '09:00', close: '10:00' } }; config.services[0].staffBufferMin = 15;
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['schedule']);
  config.therapists.forEach(therapist => { therapist.scheduleMode = 'CUSTOM'; therapist.shifts = [{ weekday: 1, startMin: 540, endMin: 615, isActive: true }]; });
  assert.deepEqual(bookingSetupIssues(config, ['7']), []);
});

test('missing or malformed buffer remains a service-policy issue instead of silently using zero', () => {
  for (const buffer of [undefined, -1, 121, 0.5]) {
    const config = fixture(); config.services[0].staffBufferMin = buffer;
    const issues = bookingSetupIssues(config, ['7']);
    assert.deepEqual(issues.map(issue => issue.kind), ['service']); assert.match(issues[0].message, /缓冲缺失或无效/);
  }
});

test('a parent needs one feasible valid option and enough staff, rather than every linked technician or longest variant', () => {
  const config = fixture(); config.businessHours = { monday: { open: '09:00', close: '09:30' } };
  config.services[0].variants.push({ durationMin: 30, priceCents: 6000, isActive: true, currency: 'usd' });
  config.therapists.push({ id: '3', name: 'Unused exception', isActive: true, serviceIds: ['7'], scheduleMode: 'CUSTOM', shifts: [] });
  assert.deepEqual(bookingSetupIssues(config, ['7']), []);
  config.services[0].variants[1].priceCents = 0;
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['hours'], 'an invalid cheap option cannot supply an appointment duration');
});

test('intentional parent pause retains its neutral status and does not add weekly or buffer repair demands', () => {
  const config = fixture(); config.services[0].isActive = false; config.services[0].staffBufferMin = undefined;
  config.therapists.forEach(therapist => { therapist.scheduleMode = 'CUSTOM'; therapist.shifts = []; });
  assert.deepEqual(bookingSetupIssues(config, ['7']).map(issue => issue.kind), ['activation']);
});

test('every active store technician serves a newly added project without any legacy links', () => {
  const config = fixture();
  config.therapists.forEach(row => { row.serviceIds = []; });
  config.services.push({ ...structuredClone(config.services[0]), id: 'new-project', name: 'New Couple project', participantCount: 2, requiredRoomType: 'COUPLE' });
  config.rooms.push({ isActive: true, roomType: 'COUPLE', capacity: 2 });
  assert.deepEqual(bookingSetupIssues(config, ['7', 'new-project']), []);
  config.therapists[1].isActive = false;
  config.therapists.push({ ...structuredClone(config.therapists[0]), id: 'foreign-active', shopId: 'another-store' });
  assert.equal(bookingSetupIssues(config, ['new-project']).filter(row => row.kind === 'staff').length, 1);
});
