/**
 * MJAPP — Admin Config DTOs
 */

import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/* ──────── Update Config Value ──────── */

export class UpdateConfigDto {
  @ApiProperty({ example: '10', description: 'New value (string)' })
  @IsString()
  value: string;

  @ApiPropertyOptional({ example: 'Platform commission rate in percent', description: 'Optional description' })
  @IsOptional()
  @IsString()
  description?: string;
}

/* ──────── Create Category ──────── */

export class CreateCategoryDto {
  @ApiProperty({ example: '推拿', description: 'Category name (Chinese)' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Tuina Massage', description: 'Category name (English)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameEn?: string;

  @ApiPropertyOptional({ example: 1, description: 'Sort order (lower = first)' })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

/* ──────── Update Category ──────── */

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: '足疗', description: 'Category name (Chinese)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Foot Reflexology', description: 'Category name (English)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameEn?: string;

  @ApiPropertyOptional({ example: 2, description: 'Sort order (lower = first)' })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({ example: true, description: 'Whether the category is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
