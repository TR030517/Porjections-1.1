import type { ServiceDurationKind } from '../utils/serviceDuration';
import type { ResourceId } from '../api/resources';

export type ReservationRoomType = 'SINGLE' | 'COUPLE' | 'FOOT_SEAT';
export type ReservationPriceBasis = 'PER_PERSON' | 'PER_BOOKING';
export interface ServiceVariant {
  id: ResourceId; serviceId: ResourceId; name: string; durationMin: number; durationKind?: ServiceDurationKind; reservedDurationMin?: number;
  priceCents: number; priceBasis: ReservationPriceBasis; currency: 'usd'; isActive: boolean; sortOrder: number;
}
export interface ReservationPolicy {
  priceBasis: ReservationPriceBasis;
  participantCount: 1 | 2; requiredStaffCount: 1 | 2;
  requiredRoomType: ReservationRoomType | null; staffBufferMin: number; roomBufferMin: number;
}
export interface ReservationService extends ReservationPolicy {
  id: ResourceId; shopId: ResourceId; name: string; isActive: boolean;
  durationMin: number; durationKind?: ServiceDurationKind; reservedDurationMin?: number; priceCents: number; variants: ServiceVariant[];
}
export interface TherapistShift {
  id: ResourceId; therapistId: ResourceId; weekday: number;
  startMin: number; endMin: number; isActive: boolean;
}
export interface ReservationTimeOff {
  id: ResourceId; therapistId: ResourceId; startAtUtc: string; endAtUtc: string; reason: string | null;
}
export interface ReservationTherapist {
  id: ResourceId; shopId: ResourceId; name: string; isActive: boolean;
  scheduleMode: 'SHOP' | 'CUSTOM';
  serviceIds: string[]; shifts: TherapistShift[]; timeOff: ReservationTimeOff[];
}
export interface RoomMaintenance {
  id: ResourceId; roomId: ResourceId; startAtUtc: string; endAtUtc: string; reason: string | null;
}
export interface ReservationRoom {
  id: ResourceId; shopId: ResourceId; name: string; roomType: ReservationRoomType;
  capacity: number; isActive: boolean; maintenance: RoomMaintenance[];
}
export interface ReservationShopBookingSettings { minimumNoticeMinutes: number; closedPeriods: Array<{ startDate: string; endDate: string }>; }
export interface ReservationConfig {
  orderOnly?: boolean; onlinePaymentEnabled?: boolean; pricingPolicy?: 'PER_ORDER'; requiresCustomerEmail?: boolean;
  shopId: ResourceId; timezone: string | null;
  businessHours?: unknown;
  bookingSettings?: ReservationShopBookingSettings;
  bookingSettingsHash?: string;
  paymentPolicy?: { payAtStoreEnabled: boolean };
  services: ReservationService[]; therapists: ReservationTherapist[]; rooms: ReservationRoom[];
}
export type ReservationResource = 'variants' | 'shifts' | 'time-off' | 'rooms' | 'maintenance';
export type ReservationFormKind = ReservationResource | 'policy' | 'schedule';
export type ReservationForm = Record<string, string | boolean>;
