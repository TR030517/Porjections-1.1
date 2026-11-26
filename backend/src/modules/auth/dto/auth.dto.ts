/**
 * MJAPP — Auth DTOs
 */

import { IsString, IsOptional, MinLength, MaxLength, IsEmail, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({ example: '+14155551234' })
  @IsString()
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+14155551234' })
  @IsString()
  phone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsOptional()
  @MaxLength(200)
  refreshToken?: string;
}

export class PasswordLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  identifier: string;
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}

export class EmailPasswordLoginDto {
  @IsEmail()
  @MaxLength(255)
  email: string;
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}

export class SocialLoginDto {
  @ApiProperty({ description: 'ID token from Apple/Google' })
  @IsString()
  @MaxLength(16000)
  idToken: string;

  @IsString() @Matches(/^[0-9a-f-]{36}$/i) challengeId: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;
}

export class EmailLoginRequestDto { @IsEmail() @MaxLength(255) email: string; }
export class EmailLoginVerifyDto {
  @IsString() @Matches(/^[0-9a-f-]{36}$/i) challengeId: string;
  @IsString() @Matches(/^\d{6}$/) code: string;
}
export class SocialChallengeDto { @IsString() @Matches(/^(GOOGLE|APPLE)$/) provider: 'GOOGLE' | 'APPLE'; }
export class LinkProviderDto extends SocialLoginDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) password?: string;
  @IsOptional() @IsString() @MaxLength(2048) reauthToken?: string;
}
