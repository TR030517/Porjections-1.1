/**
 * MJAPP — Reviews DTOs
 * Validation for creating reviews and listing shop reviews
 */

import { IsString, IsInt, IsOptional, Min, Max, IsArray, ArrayMaxSize, MaxLength, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReviewDto {
  @ApiProperty({ example: '1', description: 'Booking ID' })
  @IsString()
  bookingId: string;

  @ApiProperty({ example: 5, description: 'Rating 1-5' })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ example: 'Great massage!', description: 'Review content' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ example: ['https://...'], description: 'Review image URLs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
  images?: string[];
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ example: 4, description: 'Updated rating 1-5' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ example: 'Updated review text', description: 'Updated content' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ description: 'Updated image URLs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
  images?: string[];
}

export class ReviewListQueryDto {
  @ApiPropertyOptional({ example: '1', description: 'Shop ID to filter by' })
  @IsOptional()
  @IsString()
  shopId?: string;

  @ApiPropertyOptional({ example: 1, description: 'Page number (1-based)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, description: 'Items per page' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
