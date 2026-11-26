import { inferStoreTimezone } from '../../utils/storeTimezones';
import type { StoreDraft } from './types';

type TimezoneLocation = Pick<StoreDraft, 'city' | 'state' | 'zipCode' | 'timezone'>;

/** Existing nonempty zones are confirmed values; historical auto/manual origin is unknown. */
export function initiallyAutoMatchTimezone(timezone: string) {
  return !timezone.trim();
}

export function matchDraftTimezone<T extends TimezoneLocation>(draft: T, autoMatch: boolean): T {
  if (!autoMatch) return draft;
  const timezone = inferStoreTimezone(draft.city, draft.state, draft.zipCode);
  return timezone === draft.timezone ? draft : { ...draft, timezone };
}
