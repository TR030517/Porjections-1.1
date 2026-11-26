import { useCallback } from 'react';
import BookingSetupSummary from './BookingSetupSummary';
import { useBusinessScope } from './businessScope';
import { getReservationConfig } from '../../api/reservations';
import { linkedBookingServices, type BookingSetupIssue } from '../../utils/bookingSetup';
import type { PriceMenuGroup } from '../../utils/priceMenu';

export default function StoreBookingSetup({ shopId, menu, revision, onConfigure }: { shopId: string; menu: PriceMenuGroup[]; revision: string; onConfigure: (issue: BookingSetupIssue) => void }) {
  const scope = useBusinessScope(shopId);
  const load = useCallback(async (signal: AbortSignal) => {
    const current = scope.capture();
    if (!current()) throw Error('Session unavailable');
    const config = await getReservationConfig(shopId, signal);
    if (!current()) throw Error('Session changed');
    return config;
  }, [shopId, scope.capture]);
  return <BookingSetupSummary shopId={shopId} scopeKey={String(scope.actorId)} revision={revision} serviceIds={linkedBookingServices(menu)} load={load} onConfigure={onConfigure} />;
}
