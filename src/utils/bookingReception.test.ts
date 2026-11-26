import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingItemResources, bookingItemServiceLabel, bookingLegacyResources, bookingReceptionCustomer, bookingServiceSummary } from './bookingReception';

test('a renamed live catalog cannot change any saved participant or itinerary segment title', () => {
  const booking = {
    service: { name: 'New catalog name', durationMin: 15, priceCents: 1 },
    items: [
      { id: '3', participantIndex: 2, sequence: 1, serviceNameSnapshot: 'Original massage', variantNameSnapshot: 'Saved 90', priceCentsSnapshot: 4001, durationMin: 90 },
      { id: '2', participantIndex: 1, sequence: 2, serviceNameSnapshot: 'Original massage', variantNameSnapshot: 'Saved 30', priceCentsSnapshot: 2000, durationMin: 30 },
      { id: '1', participantIndex: 1, sequence: 1, serviceNameSnapshot: 'Original massage', variantNameSnapshot: 'Saved 60', priceCentsSnapshot: 4000, durationMin: 60 },
    ],
  };
  const before = structuredClone(booking), summary = bookingServiceSummary(booking);
  assert.equal(summary, '顾客 1 · 第 1 段：Original massage · Saved 60；顾客 1 · 第 2 段：Original massage · Saved 30；顾客 2 · 第 1 段：Original massage · Saved 90');
  assert.deepEqual(booking, before);
});

test('only genuine legacy records fall back to live or already mapped service names', () => {
  assert.equal(bookingServiceSummary({ items: [], service: { name: 'Legacy object' } }), 'Legacy object');
  assert.equal(bookingServiceSummary({ service: 'Legacy mapped' }), 'Legacy mapped');
  assert.equal(bookingServiceSummary({ items: [], serviceName: 'Legacy platform' }), 'Legacy platform');
  assert.equal(bookingServiceSummary({ items: [{}], service: { name: 'Changed object' }, serviceName: 'Changed platform' }), '历史项目名称未记录');
  assert.equal(bookingServiceSummary({ items: null, service: 'Malformed record must not borrow live title' }), '历史项目名称未记录');
  assert.equal(bookingItemServiceLabel({ serviceNameSnapshot: '  ', variantNameSnapshot: 'Saved specification' }), '历史项目名称未记录 · Saved specification');
  assert.equal(bookingServiceSummary({ items: [{ serviceNameSnapshot: 'Saved single', variantNameSnapshot: null }], service: 'Changed' }), 'Saved single');
});

test('same-named couple services remain two distinguishable participants', () => {
  const summary = bookingServiceSummary({ items: [
    { participantIndex: 2, sequence: 1, serviceNameSnapshot: 'Massage', variantNameSnapshot: '60 minutes' },
    { participantIndex: 1, sequence: 1, serviceNameSnapshot: 'Massage', variantNameSnapshot: '60 minutes' },
  ] });
  assert.equal(summary, '顾客 1 · 第 1 段：Massage · 60 minutes；顾客 2 · 第 1 段：Massage · 60 minutes');
});

test('actual ordered four-hands assignment IDs alone select names and room', () => {
  const item = { assignedTherapistIds: ['9007199254740993', '72', '9007199254740993'], assignedTherapistId: '99', assignedRoomId: '81' };
  const reception = { therapists: [
    { id: '72', name: 'Mia' }, { id: '9007199254740992', name: 'Wrong adjacent ID' }, { id: '9007199254740993', name: 'Ada' }, { id: '99', name: 'Unassigned' },
  ], rooms: [{ id: '81', name: 'Quiet room' }, { id: '82', name: 'Other room' }] };
  const before = structuredClone({ item, reception });
  assert.deepEqual(bookingItemResources(item, reception), {
    therapists: [{ id: '9007199254740993', name: 'Ada', label: 'Ada (#9007199254740993)' }, { id: '72', name: 'Mia', label: 'Mia (#72)' }],
    room: { id: '81', name: 'Quiet room', label: 'Quiet room (#81)' },
  });
  assert.deepEqual({ item, reception }, before);
});

test('deleted, unnamed, ambiguous and unmatched resources keep their exact ID fallback', () => {
  const result = bookingItemResources({ assignedTherapistIds: ['71', '72', '73'], assignedRoomId: '81' }, {
    therapists: [{ id: '71', name: null }, { id: '72', name: 'Wrong first' }, { id: '72', name: 'Wrong second' }, { id: '74', name: 'Unassigned' }],
    rooms: [{ id: '82', name: 'Unassigned room' }],
  });
  assert.deepEqual(result.therapists.map(row => row.label), ['#71', '#72', '#73']);
  assert.equal(result.room?.label, '#81');
});

test('explicit empty or malformed arrays cannot revive a stale singular assignment', () => {
  assert.deepEqual(bookingItemResources({ assignedTherapistIds: ['not-an-id', '0', '9223372036854775808'] }).therapists, []);
  for (const assignedTherapistIds of [[], null, '71', [null, 71]]) {
    assert.deepEqual(bookingItemResources({ assignedTherapistIds, assignedTherapistId: '71', therapistId: '72' }).therapists, []);
  }
  assert.deepEqual(bookingItemResources({ assignedTherapistId: '71', therapistId: '72' }).therapists.map(row => row.label), ['#71']);
  assert.deepEqual(bookingItemResources({ therapistId: '72' }).therapists.map(row => row.label), ['#72']);
});

test('legacy resource display uses the saved top-level ID and never a live therapist label', () => {
  const reception = { therapists: [{ id: '71', name: 'Assigned name' }], rooms: [] };
  assert.deepEqual(bookingLegacyResources({ therapistId: '71', therapist: { id: '72', name: 'Wrong live name' }, reception }).therapists.map(row => row.label), ['Assigned name (#71)']);
  assert.deepEqual(bookingLegacyResources({ therapist: { id: '71', name: 'Not assignment proof' }, reception }).therapists, []);
  assert.deepEqual(bookingLegacyResources({ items: [{}], therapistId: '71', reception }).therapists, []);
});

test('contact display preserves local and international phone semantics and rejects unsafe dialing', () => {
  assert.deepEqual(bookingReceptionCustomer({ customer: { name: 'Booked customer', phone: '+1 (212) 555-0199' } }), { name: 'Booked customer', phone: '+1 (212) 555-0199', phoneHref: 'tel:+12125550199' });
  assert.equal(bookingReceptionCustomer({ customer: { name: null, phone: '020 7946 0958' } }).phoneHref, 'tel:02079460958');
  for (const phone of ['javascript:alert(1)', '+1\n2125550199', '2125550199 ext42', '123456', '1234567890123456', '(unknown)', '+61 (0) 2 5555 0199', '(2125550199', 2125550199]) {
    const contact = bookingReceptionCustomer({ customer: { name: 'Known', phone } });
    assert.equal(contact.phoneHref, null);
    assert.equal(contact.phone, typeof phone === 'string' ? phone : null);
  }
  assert.deepEqual(bookingReceptionCustomer({ customer: null }), { name: '顾客姓名未提供', phone: null, phoneHref: null });
});
