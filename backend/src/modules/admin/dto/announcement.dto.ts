/**
 * MJAPP — Announcement DTOs
 */

import {
  IsString,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsEnum,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AnnouncementType {
  INFO = 'INFO',
  IMPORTANT = 'IMPORTANT',
  URGENT = 'URGENT',
}

export enum AnnouncementScope {
  ALL = 'ALL',
  USERS = 'USERS',
  MERCHANTS = 'MERCHANTS',
}

export class CreateAnnouncementDto {
  @ApiProperty({ example: 'System Maintenance Notice', description: 'Announcement title' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title: string;

  @ApiProperty({ example: 'The system will be down for maintenance...', description: 'Announcement content (supports Markdown)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  content: string;

  @ApiProperty({ enum: AnnouncementType, default: 'INFO' })
  @IsOptional()
  @IsEnum(AnnouncementType)
  type?: AnnouncementType;

  @ApiProperty({ enum: AnnouncementScope, default: 'ALL' })
  @IsOptional()
  @IsEnum(AnnouncementScope)
  scope?: AnnouncementScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '2025-06-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional({ example: '2025-07-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  endAt?: string;
}

export class UpdateAnnouncementDto {
  @ApiPropertyOptional({ example: 'Updated Title' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ example: 'Updated content...' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  content?: string;

  @ApiPropertyOptional({ enum: AnnouncementType })
  @IsOptional()
  @IsEnum(AnnouncementType)
  type?: AnnouncementType;

  @ApiPropertyOptional({ enum: AnnouncementScope })
  @IsOptional()
  @IsEnum(AnnouncementScope)
  scope?: AnnouncementScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endAt?: string;
}

export class AnnouncementQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)' })
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page' })
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ enum: AnnouncementType })
  @IsOptional()
  @IsEnum(AnnouncementType)
  type?: AnnouncementType;
}

export class AnnouncementResponseDto {
  id: string;
  title: string;
  content: string;
  type: string;
  scope: string;
  isActive: boolean;
  startAt: Date;
  endAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
