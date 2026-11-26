import { BadRequestException, ConflictException } from '@nestjs/common';
import { newTherapistSelection, planTherapistSelection, requestedTherapistUnavailable, rescheduleTherapistSelection, savedTherapistSelection } from './therapist-selection';

describe('therapist selection intent', () => {
  test('omitted choice is explicit automatic assignment', () => {
    expect(newTherapistSelection([])).toEqual({ therapistSelectionMode: 'AUTO', requestedTherapistIds: [] });
  });

  test('an explicit request is kept separate from actual assignment', () => {
    expect(newTherapistSelection(['12'])).toEqual({ therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['12'] });
  });

  test('legacy rows do not infer intent from an assigned therapist', () => {
    expect(savedTherapistSelection({ therapistSelectionMode: undefined, requestedTherapistIds: undefined })).toEqual({ therapistSelectionMode: 'LEGACY_UNKNOWN', requestedTherapistIds: [] });
  });

  test('invalid saved intent is fenced instead of silently changing the request', () => {
    expect(() => savedTherapistSelection({ therapistSelectionMode: 'AUTO', requestedTherapistIds: ['12'] })).toThrow(ConflictException);
    expect(() => savedTherapistSelection({ therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: [] })).toThrow(ConflictException);
  });

  test('rescheduling preserves automatic intent without adding a hidden preference', () => {
    expect(rescheduleTherapistSelection({ therapistSelectionMode: 'AUTO', requestedTherapistIds: [] })).toEqual({ therapistSelectionMode: 'AUTO', requestedTherapistIds: [] });
  });

  test('rescheduling rejects clearing or replacing an explicit request', () => {
    const row = { therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['12'] };
    expect(() => rescheduleTherapistSelection(row, { preferredTherapistIds: [] })).toThrow(BadRequestException);
    expect(() => rescheduleTherapistSelection(row, { therapistId: '13' })).toThrow(BadRequestException);
    expect(rescheduleTherapistSelection(row, { preferredTherapistIds: ['12'] })).toEqual(row);
  });

  test('PLAN keeps each segment preference while exposing a combined summary', () => {
    expect(planTherapistSelection([{ preferred: ['12'] }, { preferred: [] }, { preferred: ['13'] }])).toEqual({ therapistSelectionMode: 'SPECIFIC', requestedTherapistIds: ['12', '13'] });
  });

  test('unavailable requested staff has a stable conflict code for clients', () => {
    const error = requestedTherapistUnavailable();
    expect(error.getResponse()).toEqual({ code: 'REQUESTED_THERAPIST_UNAVAILABLE', message: expect.stringContaining('requested therapist') });
  });
});
