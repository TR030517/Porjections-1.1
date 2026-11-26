/**
 * MJAPP — User DTOs
 */

import { IsString, IsEmail, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Display name' })
  @IsString()
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => typeof obj[key] === 'string' ? obj[key].trim() : obj[key])
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsEmail()
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => typeof obj[key] === 'string' ? obj[key].trim().toLowerCase() : obj[key])
  @MaxLength(255)
  email?: string;
}
