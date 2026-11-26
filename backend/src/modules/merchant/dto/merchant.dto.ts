/**
 * MJAPP — Merchant DTOs
 * Covers merchant application, shop management, business hours, image/cert uploads
 */

import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsBoolean,
  IsObject,
  IsArray,
  IsEnum,
  Min,
  Max,
  ValidateNested,
  ValidateIf,
  ValidateBy,
  MaxLength,
  MinLength,
  ArrayMaxSize,
  ArrayUnique,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import type { CatalogSelectionPrecondition } from '../../../common/menu-catalog-preconditions';
import type { PriceMenuGroup } from '../../../common/shop-price-menu';
import { SERVICE_DURATION_KINDS, type ServiceDurationKind } from '../../../common/service-duration';
import { customerOrderEmail } from '../../../common/booking-order-email';

/* ───────── Apply / Register ───────── */

export class ApplyMerchantDto {
  @ApiProperty({ example: 'Happy Massage Spa' })
  @IsString()
  shopName: string;

  @ApiPropertyOptional({ example: 'Happy Massage Spa' })
  @IsOptional()
  @IsString()
  shopNameEn?: string;

  @ApiProperty({ example: '+12125551234' })
  @IsString()
  shopPhone: string;

  @ApiProperty({ example: '123 Main St' })
  @IsString()
  address: string;

  @ApiProperty({ example: 'Los Angeles' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'CA' })
  @IsString()
  state: string;

  @ApiProperty({ example: '90012' })
  @IsString()
  zipCode: string;

  @ApiProperty({ example: 34.0522 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: -118.2437 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({ enum: ['TUINA', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'MIXED'] })
  @IsEnum(['TUINA', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'MIXED'])
  category: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/license.pdf' })
  @IsOptional()
  @IsString()
  licenseUrl?: string;

  @ApiPropertyOptional({ example: 'https://example.com/business-license.pdf' })
  @IsOptional()
  @IsString()
  businessLicenseUrl?: string;
}

/* ───────── Update Shop ───────── */

export class UpdateShopDto {
  @ApiPropertyOptional({ type: [String], description: 'Store contact emails; first valid address receives new order notifications. Empty array clears contacts, without changing login credentials.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  @ValidateBy({ name: 'validStoreOrderEmails', validator: { validate: value => Array.isArray(value) && value.every(email => typeof email === 'string' && !!customerOrderEmail(email.trim())) } })
  emails?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bannerUrl?: string;

  @ApiPropertyOptional({type:[String]})
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({each:true})
  @MaxLength(500,{each:true})
  gallery?: string[];

  // Full nested shape and exact source text are checked by the shared service validator.
  @ApiPropertyOptional({ type: Array, description: 'Menu wording with explicit same-shop service/variant/add-on links and opt-in booking' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  // Prevent implicit reflected Array typing from converting each group object
  // into an Array. Preserve nested source values for strict shared validation.
  @Type(() => Object)
  priceMenu?: PriceMenuGroup[];

  @ApiPropertyOptional({ description: 'Baseline priceMenuRevision from the same shop; required when replacing a menu; includes linked catalog versions' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedPriceMenuRevision?: string;

  @ApiPropertyOptional({ type: Array, description: 'Read-only catalog selections used to verify new links before any catalog write; never stored in the menu' })
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @Type(() => Object)
  catalogSelectionPreconditions?: CatalogSelectionPrecondition[];

}

/* ───────── Business Hours ───────── */

export class BusinessHourEntry {
  @ApiProperty({ example: '09:00' })
  @IsString()
  open: string;

  @ApiProperty({ example: '21:00' })
  @IsString()
  close: string;
}

export class SetBusinessHoursDto {
  @ApiProperty({
    description: 'Day-of-week → open/close times map',
    example: { monday: [{ open: '09:00', close: '21:00' }], tuesday: [{ open: '09:00', close: '21:00' }] },
  })
  @IsObject()
  hours: Record<string, BusinessHourEntry | { closed: boolean }>;
}

/* ───────── Shop Image ───────── */

export class AddShopImageDto {
  @ApiProperty({ example: 'https://cdn.example.com/shop-photo.jpg' })
  @IsString()
  imageUrl: string;

  @ApiPropertyOptional({ enum: ['STORE_FRONT', 'INTERIOR', 'CERTIFICATE'], default: 'STORE_FRONT' })
  @IsOptional()
  @IsEnum(['STORE_FRONT', 'INTERIOR', 'CERTIFICATE'])
  imageType?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

/* ───────── Certificate Upload ───────── */

export class AddCertificateDto {
  @ApiProperty({ example: 'https://cdn.example.com/license.jpg' })
  @IsString()
  certUrl: string;

  @ApiProperty({ enum: ['MASSAGE_LICENSE', 'BUSINESS_LICENSE', 'INSURANCE'] })
  @IsEnum(['MASSAGE_LICENSE', 'BUSINESS_LICENSE', 'INSURANCE'])
  certType: string;
}

/* ───────── Shop Service Management ───────── */

export const SHOP_SERVICE_NAME_MAX_LENGTH = 200;
// MySQL TEXT stores at most 65535 bytes; character counts alone are insufficient for UTF-8.
export const SHOP_SERVICE_DESCRIPTION_MAX_BYTES = 65535;
export function validShopServiceName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= SHOP_SERVICE_NAME_MAX_LENGTH && !!value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value) && !/<\/?[a-z][^>]*>/iu.test(value);
}
export function validShopServiceDescription(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= SHOP_SERVICE_DESCRIPTION_MAX_BYTES
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) && !/<\/?[a-z][^>]*>/iu.test(value);
}

export class CreateShopServiceDto {
  @ApiPropertyOptional({ enum: SERVICE_DURATION_KINDS })
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(SERVICE_DURATION_KINDS) durationKind?: ServiceDurationKind;
  @ApiProperty({ maxLength: SHOP_SERVICE_NAME_MAX_LENGTH, description: 'Nonempty plain-text service name; display-menu names over 200 characters must be edited explicitly' })
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @ValidateBy({ name: 'shopServiceName', validator: { validate: validShopServiceName, defaultMessage: () => 'Service name must be nonempty plain text of at most 200 characters' } })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiProperty({ enum: ['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'] })
  @IsEnum(['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'])
  category: string;

  @ApiProperty({ example: 60, description: 'Explicit reservation block in minutes; non-TIMED does not promise fixed actual service minutes' })
  @Transform(({ obj, key }) => obj[key])
  @IsNumber()
  @IsInt()
  @Min(5)
  @Max(240)
  durationMin: number;

  @ApiProperty({ example: 8800 })
  @IsNumber()
  @Min(0)
  @IsInt()
  @Max(99999999)
  priceCents: number;

  @ApiPropertyOptional({ description: 'Optional plain text, up to 65535 UTF-8 bytes (MySQL TEXT)' })
  @Transform(({ obj, key }) => obj[key])
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @ValidateBy({ name: 'shopServiceDescription', validator: { validate: validShopServiceDescription, defaultMessage: () => 'Service description must be plain text of at most 65535 UTF-8 bytes' } })
  description?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'False creates an inactive service atomically; omission keeps the existing active default' })
  // Restore the raw JSON value so global implicit conversion cannot turn "false" into true.
  @Transform(({ obj, key }) => obj[key])
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateShopServiceDto {
  @ApiPropertyOptional({ enum: SERVICE_DURATION_KINDS })
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(SERVICE_DURATION_KINDS) durationKind?: ServiceDurationKind;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(['MASSAGE', 'REFLEXOLOGY', 'CUPPING', 'SCRAPING', 'HEAD_THERAPY', 'OTHER'])
  category?: string;

  @ApiPropertyOptional()
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  // Stored legacy bases may be echoed unchanged for a service with variants.
  // The locked service guard enforces5–240 for a base that actually takes effect.
  @IsNumber() @IsInt() durationMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @IsInt()
  @Max(99999999)
  priceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTherapistDto {
  @Transform(({ obj, key }) => obj[key])
  @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @Transform(({ obj, key }) => obj[key])
  @IsOptional() @IsString() @MaxLength(1000)
  avatarUrl?: string;

  @Transform(({ obj, key }) => obj[key])
  @IsOptional() @IsString() @MaxLength(100)
  title?: string;

  @Transform(({ obj, key }) => obj[key])
  @IsOptional() @IsString() @MaxLength(5000)
  bio?: string;

  @Transform(({ obj, key }) => obj[key])
  @IsOptional() @IsInt() @Min(0) @Max(80)
  yearsExp?: number;

  @Transform(({ obj, key }) => obj[key])
  @IsOptional() @IsString() @MaxLength(10)
  gender?: string;

  @ApiPropertyOptional({ type: [String], description: 'Services belonging to this shop; an empty array clears associations' })
  @Transform(({ obj, key }) => obj[key])
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique()
  @IsString({ each: true }) @Matches(/^[1-9]\d{0,18}$/, { each: true })
  serviceIds?: string[];
}

export class UpdateTherapistDto extends PartialType(CreateTherapistDto) {
  @Transform(({ obj, key }) => obj[key])
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

/* ───────── Statistics / Dashboard ───────── */

export class DashboardQueryDto {
  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)', default: '30 days ago' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)', default: 'today' })
  @IsOptional()
  @IsString()
  endDate?: string;
}

/* ───────── Stripe Connect Onboarding ───────── */

export class CreateStripeOnboardingDto {
  @ApiProperty({ description: 'Shop ID to onboard for Stripe' })
  @IsString()
  shopId: string;

  @ApiPropertyOptional({ description: 'Stripe account country (default: US)' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'Stripe account email' })
  @IsOptional()
  @IsString()
  email?: string;
}

export class StripeOnboardingStatusDto {
  @ApiProperty({ description: 'Shop ID' })
  @IsString()
  shopId: string;
}

export class StripeOnboardingStatusResponse {
  @ApiProperty()
  isCompleted: boolean;

  @ApiProperty({ required: false })
  stripeAccountId?: string;

  @ApiProperty({ required: false })
  onboardingUrl?: string;

  @ApiProperty()
  shopId: string;
}

export class StripeOnboardingResponse {
  @ApiProperty()
  url: string;

  @ApiProperty()
  stripeAccountId: string;
}

export class StripePayoutRequestDto {
  @ApiProperty({ description: 'Amount in cents to withdraw', example: 5000 })
  @IsNumber()
  @Min(1000)
  amountCents: number;
}

/* ───────── Payout / Withdrawal ───────── */

export class PayoutRequestDto {
  @ApiProperty({ description: 'Amount in cents to withdraw (minimum 1000 = $10)', example: 5000 })
  @IsNumber()
  @Min(1000)
  amountCents: number;
}

/* ───────── Transactions ───────── */

export class MerchantShopQueryDto {
  @ApiPropertyOptional({ description: 'Explicit owned shop ID; required for merchants with multiple shops' })
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/)
  shopId?: string;
}

export class TransactionQueryDto extends MerchantShopQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Start date filter (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date filter (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class TransactionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bookingId: string | null;

  @ApiProperty({ enum: ['PAYMENT', 'PAYOUT', 'REFUND'] })
  type: string;

  @ApiProperty({ description: 'Amount in cents' })
  amount: number;

  @ApiProperty({ description: 'Fee in cents' })
  fee: number;

  @ApiProperty({ description: 'Net amount in cents' })
  net: number;

  @ApiProperty({ enum: ['COMPLETED', 'PENDING', 'FAILED'] })
  status: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  description: string;
}

export class PaginatedTransactionsDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  items: TransactionResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}

/* ───────── Tax Report (P2-T04-US-006) ───────── */

export class TaxReportQueryDto extends MerchantShopQueryDto {
  @ApiProperty({ description: 'Tax year (e.g. 2025, 2026)', example: 2026 })
  @IsOptional()
  @Type(() => Number)
  year?: number;
}

export class TaxReportResponseDto {
  @ApiProperty({ description: 'Total gross revenue before fees, in cents' })
  total_gross: number;

  @ApiProperty({ description: 'Total platform/processing fees, in cents' })
  total_platform_fees: number;

  @ApiProperty({ description: 'Total net after fees, in cents' })
  total_net: number;

  @ApiProperty({ description: 'Total refunded amount, in cents' })
  total_refunds: number;

  @ApiProperty({ description: 'Total payout amount, in cents' })
  total_payouts: number;

  @ApiProperty({ description: 'Net earnings (total_net - total_refunds - total_payouts), in cents' })
  net_earnings: number;
}
