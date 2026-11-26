/**
 * MJAPP — Booking DTOs
 * Validation for booking creation, cancellation, and slot queries
 */

import { IsString, IsOptional, IsInt, Min, Max, MaxLength, MinLength, Matches, IsArray, ArrayMinSize, ArrayMaxSize, ArrayUnique, IsIn, IsDefined, IsObject, ValidateBy, ValidateNested, ValidateIf } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { BookingContactInput, normalizeBookingContact, normalizeGuestBookingContact } from '../../../common/booking-contact';

const ContactField = (field: keyof BookingContactInput) => ValidateBy({
  name: 'bookingContact' + field,
  validator: {
    validate(value: unknown) {
      try { normalizeBookingContact({ name: 'Contact', phone: '+12025550123', email: 'contact@example.test', [field]: value }); return true; }
      catch { return false; }
    },
    defaultMessage: () => 'Provide a valid booking contact ' + field + '.',
  },
});
export class BookingContactDto implements BookingContactInput {
  // Match main.ts's implicit conversion boundary without coercing numeric or
  // boolean JSON into contact strings. Domain normalization happens in service.
  @Transform(({ obj, key }) => obj[key]) @ContactField('name') name!: string;
  @Transform(({ obj, key }) => obj[key]) @ContactField('phone') phone!: string;
  @Transform(({ obj, key }) => obj[key]) @ContactField('email') email!: string;
}

export class BookingAddOnSelectionDto {
  @Transform(({ obj, key }) => obj[key]) @IsInt() @Min(1) @Max(6) participantIndex!: number;
  @Transform(({ obj, key }) => obj[key]) @IsInt() @Min(1) @Max(4) sequence!: number;
  @Transform(({ obj, key }) => obj[key]) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique()
  @IsString({ each: true }) @Matches(/^[1-9]\d{0,18}$/, { each: true }) addOnIds!: string[];
}

export class ReservationSelectionDto {
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  variantId?: string;

  @IsOptional()
  @ApiPropertyOptional({ description: 'Explicitly requested therapist IDs. Omit or send [] for automatic assignment; assignments are returned separately.' })
  @Transform(({ value }) => typeof value === 'string' ? value.split(',') : value)
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[1-9]\d{0,18}$/, { each: true })
  preferredTherapistIds?: string[];
}

export class SlotsQueryDto extends ReservationSelectionDto {
  @ApiProperty({ example: '1', description: 'Shop ID' })
  @IsString()
  shopId: string;

  @ApiProperty({ example: '1', description: 'Service ID (to determine duration)' })
  @IsString()
  serviceId: string;

  @ApiPropertyOptional({ example: '1', description: 'Therapist ID (optional, for filtered slots)' })
  @IsOptional()
  @IsString()
  therapistId?: string;

  @ApiProperty({ example: '2026-06-07', description: 'Date (YYYY-MM-DD)' })
  @IsString()
  date: string;
}

/** Internal assisted slots use the route shop and the same resource selection
 * as public slots. A caller cannot inject a contact or customer identity. */
export class AssistedBookingSlotsQueryDto extends OmitType(SlotsQueryDto, ['shopId'] as const) {}

export class CreateBookingDto extends ReservationSelectionDto {
  @ApiProperty({ type: BookingContactDto })
  @IsDefined() @IsObject() @ValidateNested() @Type(() => BookingContactDto) contact!: BookingContactDto;
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMaxSize(12)
  @ValidateNested({ each: true }) @Type(() => BookingAddOnSelectionDto) addOnSelections?: BookingAddOnSelectionDto[];
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(30) quoteExpiresAt?: string;
  @IsOptional() @IsInt() @Min(0) @Max(9999999) tipCents?: number;
  @IsOptional() @IsIn(['ONLINE', 'PAY_AT_STORE']) paymentMode?: 'ONLINE' | 'PAY_AT_STORE';
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{1,100}$/)
  requestKey?: string;
  @ApiProperty({ example: '1', description: 'Shop ID' })
  @IsString()
  shopId: string;

  @ApiProperty({ example: '1', description: 'Service ID' })
  @IsString()
  serviceId: string;

  @ApiPropertyOptional({ example: '1', description: 'Therapist ID (optional)' })
  @IsOptional()
  @IsString()
  therapistId?: string;

  @ApiProperty({ example: '2026-06-07', description: 'Booking date (YYYY-MM-DD)' })
  @IsString()
  date: string;

  @ApiProperty({ example: '09:00', description: 'Start time (HH:MM)' })
  @IsString()
  startTime: string;

  @ApiPropertyOptional({ example: 60, description: 'Must equal the selected primary/variant reservation block; never changes server duration kind or price.' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  durationMin?: number;

  @ApiPropertyOptional({ description: 'Notes for the booking' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ example: '1', description: 'UserCoupon ID to redeem for this booking' })
  @IsOptional()
  @IsString()
  couponId?: string;
}

export class PlanItemDto {
  @IsInt() @Min(1) @Max(6) participantIndex!: number;
  @IsInt() @Min(1) @Max(4) sequence!: number;
  @IsString() @Matches(/^[1-9]\d{0,18}$/) serviceId!: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/) variantId?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/) therapistId?: string;
}
export class PlanSlotsDto {
  @IsString() @Matches(/^[1-9]\d{0,18}$/) shopId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => PlanItemDto) items!: PlanItemDto[];
}
export class CreatePlanDto extends PlanSlotsDto {
  @ApiProperty({ type: BookingContactDto })
  @IsDefined() @IsObject() @ValidateNested() @Type(() => BookingContactDto) contact!: BookingContactDto;
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMaxSize(12)
  @ValidateNested({ each: true }) @Type(() => BookingAddOnSelectionDto) addOnSelections?: BookingAddOnSelectionDto[];
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(30) quoteExpiresAt?: string;
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,100}$/) requestKey!: string;
  @IsOptional() @IsIn(['ONLINE', 'PAY_AT_STORE']) paymentMode?: 'ONLINE' | 'PAY_AT_STORE';
  @IsOptional() @IsInt() @Min(0) @Max(9999999) tipCents?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/) couponId?: string;
}
export class QuoteBookingDto extends OmitType(CreateBookingDto, ['contact', 'requestKey', 'quoteHash', 'quoteExpiresAt'] as const) {}
export class QuotePlanDto extends OmitType(CreatePlanDto, ['contact', 'requestKey', 'quoteHash', 'quoteExpiresAt'] as const) {}

export class AssistedBookingCustomerQueryDto {
  @IsString() @MinLength(2) @MaxLength(100) @Matches(/^[^\u0000-\u001f\u007f]+$/) search!: string;
}

export class AssistedBookingQuoteDto extends OmitType(QuoteBookingDto, ['shopId', 'paymentMode', 'tipCents', 'couponId'] as const) {
  @IsDefined() @IsObject() @ValidateNested() @Type(() => BookingContactDto) contact!: BookingContactDto;
  @IsString() @Matches(/^[1-9]\d{0,18}$/) customerId!: string;
}

export class CreateAssistedBookingDto extends OmitType(CreateBookingDto, ['contact', 'shopId', 'paymentMode', 'tipCents', 'couponId', 'requestKey'] as const) {
  // Undefined is only for replaying a pre-snapshot command. The service refuses
  // new creation without contact after checking the original idempotent result.
  @ValidateIf((_object, value) => value !== undefined) @IsObject() @ValidateNested() @Type(() => BookingContactDto) contact?: BookingContactDto;
  @IsString() @Matches(/^[1-9]\d{0,18}$/) customerId!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,100}$/) requestKey!: string;
}
const GuestContactField = (field: 'name' | 'phone' | 'email') => ValidateBy({
  name: 'guestBookingContact' + field,
  validator: {
    validate(value: unknown) {
      try { normalizeGuestBookingContact({ name: 'Contact', phone: '+12025550123', email: null, [field]: value }); return true; } catch { return false; }
    },
    defaultMessage: () => 'Provide a valid guest contact ' + field + '.',
  },
});
export class GuestBookingContactDto {
  @Transform(({ obj, key }) => obj[key]) @GuestContactField('name') name!: string;
  @Transform(({ obj, key }) => obj[key]) @GuestContactField('phone') phone!: string;
  @Transform(({ obj, key }) => obj[key]) @GuestContactField('email') email?: string | null;
}
export class GuestAssistedBookingQuoteDto extends OmitType(QuoteBookingDto, ['shopId', 'paymentMode', 'tipCents', 'couponId'] as const) {
  @IsDefined() @IsObject() @ValidateNested() @Type(() => GuestBookingContactDto) contact!: GuestBookingContactDto;
  @Transform(({ obj, key }) => obj[key]) @IsIn(['PHONE', 'WALK_IN']) guestSource!: 'PHONE' | 'WALK_IN';
}
export class CreateGuestAssistedBookingDto extends GuestAssistedBookingQuoteDto {
  @Transform(({ obj, key }) => obj[key]) @IsString() @Matches(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i) requestKey!: string;
  @Transform(({ obj, key }) => obj[key]) @IsString() @Matches(/^[a-f0-9]{64}$/) quoteHash!: string;
  @Transform(({ obj, key }) => obj[key]) @IsString() @MaxLength(30) quoteExpiresAt!: string;
}
export class RescheduleSlotsDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
}

export class RescheduleBookingDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[1-9]\d{0,18}$/, { each: true })
  preferredTherapistIds?: string[];
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime: string;

  @IsOptional()
  @IsString()
  therapistId?: string;
}

export class CancelBookingDto {
  @ApiPropertyOptional({ description: 'Required for a new administrator cancellation', type: String, maxLength: 500 })
  cancelReason?: string;
}

export class RefundBookingDto {
  @ApiPropertyOptional({ example: 'Full refund', description: 'Reason for refund' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PartialRefundBookingDto {
  @ApiProperty({ example: 2500, description: 'Amount to refund in cents' })
  @IsInt()
  @Min(1)
  @Max(99999999)
  amountCents: number;
}
