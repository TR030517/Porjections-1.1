import { bookingDurationLabel, serviceDurationLabel, type BookingDurationKind } from '../utils/serviceDuration';

/** Present already validated metadata; callers pass saved item types for history. */
export default function ServiceDurationLabel({ kind, minutes, total = false }: { kind?: BookingDurationKind; minutes: number; total?: boolean }) {
  return <span>{total ? bookingDurationLabel(kind, minutes) : serviceDurationLabel(kind, minutes)}</span>;
}
