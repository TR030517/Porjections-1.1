/**
 * MJAPP — Booking Manage DTOs
 *
 * DTOs for the admin global order management: querying bookings,
 * viewing full order details, and handling disputes.
 */

import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
  IsNumber,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class BookingManageQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by booking status',
    enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by payment status',
    enum: ['UNPAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['UNPAID', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'])
  paymentStatus?: string;

  @ApiPropertyOptional({ description: 'Search by shop name', example: 'Massage' })
  @IsOptional()
  @IsString()
  shopSearch?: string;

  @ApiPropertyOptional({ description: 'Search by user phone number', example: '1415' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Filter by bookingNo (exact match)', example: 'MJ00A1B2C' })
  @IsOptional()
  @IsString()
  bookingNo?: string;

  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)', example: '2026-12-31' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class DisputeDto {
  @ApiProperty({
    description: 'Dispute resolution action',
    enum: ['REFUND', 'PARTIAL_REFUND', 'DISMISS'],
    example: 'REFUND',
  })
  @IsString()
  @IsIn(['REFUND', 'PARTIAL_REFUND', 'DISMISS'])
  action: string;

  @ApiPropertyOptional({
    description: 'Refund amount in cents (required for PARTIAL_REFUND)',
    example: 5000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiProperty({
    description: 'Reason for the dispute resolution decision',
    example: 'Service quality issue confirmed by both parties',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}
