/**
 * MJAPP — Shop Review DTOs
 *
 * DTOs for the admin shop review flow: querying pending shops,
 * submitting review decisions (approve/reject/request-info).
 */

import { IsString, IsOptional, IsIn, IsInt, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ShopReviewQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by review status',
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'])
  reviewStatus?: string;

  @ApiPropertyOptional({ description: 'Search by shop name or phone', example: 'Massage' })
  @IsOptional()
  @IsString()
  search?: string;

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

export class ReviewShopDto {
  @ApiProperty({
    description: 'Review action',
    enum: ['APPROVE', 'REJECT', 'REQUEST_INFO'],
    example: 'APPROVE',
  })
  @IsString()
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_INFO'])
  action: string;

  @ApiPropertyOptional({
    description: 'Review reason (required for REJECT / REQUEST_INFO)',
    example: 'Business license missing',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
