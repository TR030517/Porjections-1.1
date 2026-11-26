/**
 * MJAPP — Shop DTOs
 */

import { IsOptional, IsString, IsNumber, Min, Max, IsInt, MaxLength, Matches, IsEnum } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ShopCategory, ShopType } from '@prisma/client';

export class ShopListQueryDto {
  @ApiPropertyOptional({ description: 'User latitude for GPS sorting' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lat?: number;

  @ApiPropertyOptional({ description: 'User longitude for GPS sorting' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lng?: number;

  @ApiPropertyOptional({ description: 'Search radius in kilometers (default: 50)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  radius?: number;

  @ApiPropertyOptional({ description: 'Shop category filter', enum: ShopCategory })
  @IsOptional()
  @IsEnum(ShopCategory)
  category?: ShopCategory;

  @ApiPropertyOptional({ description: 'Search keyword (name, address, city)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ description: 'City filter' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

export class NearbyQueryDto {
  @ApiProperty({ description: 'User latitude' })
  @IsNumber()
  @Type(() => Number)
  lat!: number;

  @ApiProperty({ description: 'User longitude' })
  @IsNumber()
  @Type(() => Number)
  lng!: number;

  @ApiPropertyOptional({ description: 'Radius in kilometers (default: 25)' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  radius?: number;

  @ApiPropertyOptional({ description: 'Max results (default: 20)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;
}

export class ResolveShopQueryDto {
  @IsOptional() @IsString() @MaxLength(100)
  shortName?: string;

  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/)
  legacyId?: string;
}
