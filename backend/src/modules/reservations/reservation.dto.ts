import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/swagger';
import { ROOM_TYPES } from './reservation-validation';
import { Transform, Type } from 'class-transformer';
const ID = /^[1-9]\d{0,18}$/;
const UTC = /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
export class CreateVariantDto {
  @IsOptional() @IsIn(['PER_PERSON', 'PER_BOOKING']) priceBasis?: string;
  @IsString() @Matches(ID) serviceId!: string;
  @IsString() @MaxLength(100) name!: string;
  @Transform(({ obj, key }) => obj[key]) @IsInt() @Min(5) @Max(240) durationMin!: number;
  @IsInt() @Min(1) @Max(10000000) priceCents!: number;
  @IsOptional() @IsIn(['usd']) currency?: string;
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined) @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}
export class UpdateVariantDto extends PartialType(OmitType(CreateVariantDto, ['serviceId'] as const), { skipNullProperties: false }) {}
export class ServicePolicyDto {
  @IsOptional() @IsInt() @Min(1) @Max(2) participantCount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(2) requiredStaffCount?: number;
  @ValidateIf((_object, value) => value !== undefined && value !== null) @IsIn(ROOM_TYPES) requiredRoomType?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(120) staffBufferMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) roomBufferMin?: number;
}
export class CreateShiftDto {
  @IsString() @Matches(ID) therapistId!: string;
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsInt() @Min(0) @Max(1439) startMin!: number;
  @IsInt() @Min(1) @Max(1440) endMin!: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateShiftDto extends PartialType(OmitType(CreateShiftDto, ['therapistId'] as const)) {}
export class CreateTimeOffDto {
  @IsString() @Matches(ID) therapistId!: string;
  @IsString() @Matches(UTC) startAtUtc!: string;
  @IsString() @Matches(UTC) endAtUtc!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}
export class UpdateTimeOffDto extends PartialType(OmitType(CreateTimeOffDto, ['therapistId'] as const)) {}
export class CreateRoomDto {
  @IsString() @MaxLength(100) name!: string;
  @IsIn(ROOM_TYPES) roomType!: string;
  @IsInt() @Min(1) @Max(2) capacity!: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateRoomDto extends PartialType(CreateRoomDto) {}
export class CreateMaintenanceDto {
  @IsString() @Matches(ID) roomId!: string;
  @IsString() @Matches(UTC) startAtUtc!: string;
  @IsString() @Matches(UTC) endAtUtc!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}
export class UpdateMaintenanceDto extends PartialType(OmitType(CreateMaintenanceDto, ['roomId'] as const)) {}

export class ReservationHoursDto { @IsObject() businessHours!: Record<string, unknown>; }
export class ClosedPeriodDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) startDate!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) endDate!: string;
}
export class ShopBookingSettingsDto {
  @Transform(({ obj, key }) => obj[key]) @IsString() @Matches(/^[a-f0-9]{64}$/) expectedSettingsHash!: string;
  @Transform(({ obj, key }) => obj[key]) @IsInt() @Min(0) @Max(10080) minimumNoticeMinutes!: number;
  @IsArray() @ArrayMaxSize(50) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => ClosedPeriodDto) closedPeriods!: ClosedPeriodDto[];
}
export class ShopPaymentPolicyDto { @IsBoolean() payAtStoreEnabled!: boolean; }

export class TherapistScheduleDto { @IsIn(['SHOP', 'CUSTOM']) scheduleMode!: 'SHOP' | 'CUSTOM'; }

export class StaffingTargetDto {
  @Transform(({ obj, key }) => obj[key]) @IsInt() @Min(0) @Max(100) targetActiveCount!: number;
  @Transform(({ obj, key }) => obj[key]) @IsString() @Matches(/^[a-f0-9]{64}$/) expectedRevision!: string;
}

export class MenuCatalogQueryDto {
  @Transform(({ obj, key }) => obj[key]) @IsIn(['service', 'variant', 'addOn']) kind!: 'service' | 'variant' | 'addOn';
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsString() @Matches(ID) serviceId?: string;
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsString() @MaxLength(100) q?: string;
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsString() @Matches(/^[1-9]\d*$/) page?: string;
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsString() @Matches(/^[1-9]\d*$/) pageSize?: string;
}

export class ProjectCatalogQueryDto {
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsString() @MaxLength(100) @Matches(/^[^\u0000-\u001f\u007f]*$/) search?: string;
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['all', 'active', 'inactive']) status?: 'all' | 'active' | 'inactive';
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsString() @Matches(/^[1-9]\d*$/) page?: string;
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsString() @Matches(/^[1-9]\d*$/) pageSize?: string;
  @Transform(({ obj, key }) => obj[key]) @ValidateIf((_object, value) => value !== undefined)
  @IsString() @Matches(ID) serviceId?: string;
}

