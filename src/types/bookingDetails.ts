import type { ServiceDurationKind, BookingDurationKind } from '../utils/serviceDuration';
import type { BookingReception } from '../utils/bookingReception';
export interface BookingSegment {
  id: string; participantIndex: number; sequence?: number; offsetMin?: number; preparationMin?: number;
  serviceNameSnapshot: string; variantNameSnapshot: string | null; durationMin: number; durationKind?: ServiceDurationKind; durationKindSnapshot?: ServiceDurationKind; reservedDurationMin?: number;
  priceCentsSnapshot: number; quotedUnitPriceCents?: number | null; priceBasisSnapshot?: string;
  currency?: string; timezone?: string | null; startAtUtc?: string; endAtUtc?: string;
  localStartTime?: string; localEndTime?: string;
  therapistId?: string | null; assignedTherapistId?: string | null; assignedTherapistIds?: string[]; assignedRoomId: string | null;
}
export interface BookingDetail {
  orderOnly?: boolean; onlinePaymentEnabled?: boolean; pricingPolicy?: 'PER_ORDER'; paymentMode?: 'ONLINE' | 'PAY_AT_STORE' | 'ZERO';
  id: string; durationMin?: number; durationKind?: BookingDurationKind; reservedDurationMin?: number; status: string; paymentStatus: string; reservationKind?: string; currency: string;
  cancelReason?: string | null;
  startTime: string; endTime: string; timezone: string | null;
  priceCents?: number; discountCents?: number; platformFeeCents?: number; tipCents?: number;
  totalCents: number; paidCents: number; refundedCents: number;
  localDate: string | null; localStartTime: string | null; holdExpiresAt: string | null;
  items: BookingSegment[];
  addOns?: Array<{id:string;bookingItemId:string;sourceAddOnId:string;participantIndex:number;sequence:number;name:string;unitPriceCents:number;quantity:1;lineTotalCents:number;currency:string}>;
  mainSubtotalCents?:number;addOnSubtotalCents?:number;
  participantCount?: number; requiredStaffCount?: number;
  therapistId?: string | null;
  service?: { name?: string } | null;
  serviceName?: string;
  reception?: BookingReception;
  contact?: unknown;
}
export interface BookingRescheduleSlots { date: string; timezone: string; slots: Array<{ time: string; available: boolean }> }
