import { BadRequestException, ConflictException } from '@nestjs/common';

export type TherapistSelectionMode = 'AUTO' | 'SPECIFIC' | 'LEGACY_UNKNOWN';
export type TherapistSelection = { therapistSelectionMode: TherapistSelectionMode; requestedTherapistIds: string[] };
type SavedSelection = { therapistSelectionMode?: unknown; requestedTherapistIds?: unknown };
type SelectionInput = { therapistId?: string; preferredTherapistIds?: string[] };

/** The request is independent of whichever employees the allocator returns. */
export function newTherapistSelection(ids: string[]): TherapistSelection {
  return { therapistSelectionMode: ids.length ? 'SPECIFIC' : 'AUTO', requestedTherapistIds: [...ids] };
}

export function savedTherapistSelection(row: SavedSelection): TherapistSelection {
  const mode = row.therapistSelectionMode;
  // Existing orders have assignments, but no evidence of the original choice.
  if (mode == null || mode === 'LEGACY_UNKNOWN') return { therapistSelectionMode: 'LEGACY_UNKNOWN', requestedTherapistIds: [] };
  const ids = row.requestedTherapistIds;
  if (!['AUTO', 'SPECIFIC'].includes(String(mode)) || !Array.isArray(ids)
    || ids.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))
    || new Set(ids).size !== ids.length || mode === 'AUTO' && ids.length || mode === 'SPECIFIC' && !ids.length) {
    throw new ConflictException('The saved therapist request needs review before this booking can be moved');
  }
  return { therapistSelectionMode: mode as TherapistSelectionMode, requestedTherapistIds: [...ids] };
}

/** Rescheduling moves the existing request; it cannot silently rewrite it. */
export function rescheduleTherapistSelection(row: SavedSelection, input: SelectionInput = {}): TherapistSelection {
  const saved = savedTherapistSelection(row);
  if (input.therapistId !== undefined || input.preferredTherapistIds !== undefined) {
    const supplied = input.preferredTherapistIds ?? (input.therapistId ? [input.therapistId] : []);
    if (!Array.isArray(supplied) || input.therapistId !== undefined && (supplied.length !== 1 || supplied[0] !== input.therapistId)
      || [...supplied].sort().join(',') !== [...saved.requestedTherapistIds].sort().join(',')) {
      throw new BadRequestException('Rescheduling preserves the saved therapist request; it cannot replace or clear it');
    }
  }
  return saved;
}

export function planTherapistSelection(segments: Array<{ preferred: string[] }>): TherapistSelection {
  return newTherapistSelection([...new Set(segments.flatMap(segment => segment.preferred))]);
}

export function requestedTherapistUnavailable(): ConflictException {
  return new ConflictException({ code: 'REQUESTED_THERAPIST_UNAVAILABLE', message: 'A requested therapist is unavailable at this time. Choose another time; the original booking has not changed.' });
}
