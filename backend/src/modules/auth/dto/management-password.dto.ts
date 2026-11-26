import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangeManagementPasswordDto {
  @IsString() @MinLength(1) @MaxLength(200)
  currentPassword: string;

  // The service enforces the current role's policy in UTF-8 bytes.
  @IsString() @MinLength(1) @MaxLength(200)
  newPassword: string;
}

export class RecoverManagementPasswordDto extends ChangeManagementPasswordDto {
  @IsString() @MinLength(1) @MaxLength(1000)
  reason: string;

  // Reference an identity verification record; never send identity documents.
  @IsString() @Matches(/^[A-Za-z][A-Za-z0-9._:-]{5,79}$/)
  verificationReference: string;
}
