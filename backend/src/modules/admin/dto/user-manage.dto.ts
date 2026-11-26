/**
 * MJAPP — User Management DTOs
 *
 * DTOs for the admin user management endpoints: listing users,
 * viewing user details, and updating user status.
 *
 * Note: Status values (ACTIVE | SUSPENDED | DELETED) map directly
 * to the Prisma UserStatus enum. No schema changes required.
 */

import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UserManageQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by user status',
    enum: ['ACTIVE', 'SUSPENDED', 'DELETED'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'SUSPENDED', 'DELETED'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Search by phone or email',
    example: '14155551234',
  })
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

export class UpdateUserStatusDto {
  @ApiProperty({
    description: 'New user status',
    enum: ['ACTIVE', 'SUSPENDED', 'DELETED'],
    example: 'SUSPENDED',
  })
  @IsString()
  @IsIn(['ACTIVE', 'SUSPENDED', 'DELETED'])
  status: string;

  @ApiPropertyOptional({
    description: 'Reason for the status change',
    example: 'Violation of terms of service',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}
