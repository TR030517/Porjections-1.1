/**
 * MJAPP — FCM Token Registration DTO
 */
import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterFcmTokenDto {
  // Reject numeric/object input even with global implicit conversion enabled.
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  @Matches(/^[\x21-\x7e]+$/)
  token: string;
}
