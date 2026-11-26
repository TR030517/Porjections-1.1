/**
 * MJAPP — Admin DTOs
 */

import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({ example: '+14155551234', description: 'Admin phone number' })
  @IsString()
  phone: string;

  @ApiProperty({ example: '000000', description: 'OTP code (6 digits)' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code: string;
}

export class AdminRefreshTokenDto {
  @ApiProperty({ description: 'Refresh token' })
  @IsString()
  refreshToken: string;
}

export class AdminProfileResponseDto {
  @ApiProperty({ example: '1' })
  id: string;

  @ApiProperty({ example: '+14155551234' })
  phone: string;

  @ApiProperty({ example: 'admin@massajoy.com', required: false })
  @IsOptional()
  email?: string;

  @ApiProperty({ example: 'Admin', required: false })
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'ADMIN' })
  role: string;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiProperty({ example: '2025-06-01T00:00:00.000Z' })
  createdAt: Date;
}
