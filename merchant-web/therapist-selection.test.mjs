import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { createServer } from 'vite';

test('merchant distinguishes the saved request from the actual employee and explains rescheduling', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { savedTherapistRequest, therapistRequestLabel, therapistMoveNotice } = await vite.ssrLoadModule('/src/utils/therapistSelection.ts');
    assert.deepEqual(savedTherapistRequest({ therapistId: '12' }), { therapistSelectionMode: 'LEGACY_UNKNOWN', requestedTherapistIds: [] });
    assert.equal(therapistRequestLabel({ therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['11'], therapistId: '12' }), '明确指定：#11');
    assert.match(therapistMoveNotice({ therapistSelectionMode: 'AUTO' }), /可能更换/);
    assert.match(therapistMoveNotice({ therapistSelectionMode: 'SPECIFIC' }), /保留已指定技师/);
    assert.match(therapistMoveNotice({ reservationKind: 'PLAN' }), /逐段保留/);
    assert.throws(() => savedTherapistRequest({ therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: [] }), /无法核对/);
  } finally { await vite.close(); }
});

test('booking detail retains distinct per-segment requests and reschedule sends only time', async () => {
  const requests = [];
  const items = [{ id: '1', participantIndex: 1, sequence: 1, durationMin: 30, priceCentsSnapshot: 2500,
    therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['11'], assignedTherapistId: '11' },
  { id: '2', participantIndex: 1, sequence: 2, durationMin: 30, priceCentsSnapshot: 2500,
    therapistSelectionMode: 'AUTO', requestedTherapistIds: [], assignedTherapistId: '12' }];
  axios.defaults.adapter = async config => {
    requests.push(config.data ? JSON.parse(config.data) : null);
    return { config, data: { id: '42', shopId: '2', durationMin: 60, priceCents: 5000, reservationKind: 'PLAN',
      therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['11'], therapistId: '11', items }, status: 200, statusText: 'OK', headers: {} };
  };
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { getBooking, rescheduleBooking } = await vite.ssrLoadModule('/src/api/bookings.ts');
    const detail = await getBooking('42', '2');
    assert.deepEqual(detail.requestedTherapistIds, ['11']);
    assert.deepEqual(detail.items.map(item => [item.therapistSelectionMode, item.requestedTherapistIds, item.assignedTherapistId]), [['SPECIFIC', ['11'], '11'], ['AUTO', [], '12']]);
    await rescheduleBooking('42', { date: '2035-01-02', startTime: '10:00' });
    assert.deepEqual(requests[1], { date: '2035-01-02', startTime: '10:00' });
  } finally { await vite.close(); }
});
