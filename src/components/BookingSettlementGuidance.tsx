import { bookingSettlementGuidance } from '../utils/bookingSettlementGuidance';

export default function BookingSettlementGuidance({ settlements }: { settlements: unknown }) {
  const guidance = bookingSettlementGuidance(settlements);
  return <div className="mt-3 text-xs leading-6 text-slate-500" aria-label="当前结算说明"><p className="font-medium text-slate-700">{guidance.title}</p><p>{guidance.message}</p></div>;
}
