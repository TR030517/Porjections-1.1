import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangeCustomerPasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) currentPassword: string;
  @IsString() @MinLength(1) @MaxLength(200) newPassword: string;
}

export class RequestCustomerPasswordRecoveryDto {
  @IsEmail() @MaxLength(255) email: string;
}

export class CompleteCustomerPasswordRecoveryDto {
  @IsString() @Matches(/^[0-9a-f-]{36}$/i) challengeId: string;
  @IsString() @Matches(/^\d{6}$/) code: string;
  @IsString() @MinLength(1) @MaxLength(200) newPassword: string;
}
