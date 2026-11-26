import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ACCOUNT_ID_PATTERN, ACCOUNT_PERMISSIONS, AccountPermission } from './account-access.validation';

export class AccountReasonDto {
  @IsString() @MinLength(1) @MaxLength(1000) reason: string;
}
export class BindShopLoginDto extends AccountReasonDto {
  @IsString() @Matches(ACCOUNT_ID_PATTERN) shopId: string;
  @IsString() @Matches(ACCOUNT_ID_PATTERN) userId: string;
}
export class CreateAndBindShopAccountDto extends AccountReasonDto {
  @IsString() @Matches(ACCOUNT_ID_PATTERN) shopId: string;
  @IsString() @MinLength(3) @MaxLength(64) loginName: string;
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsString() @MinLength(6) @MaxLength(72) password: string;
  @IsEmail() @MaxLength(255) email: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/) idempotencyKey: string;
}
export class GrantShopAccountDto extends AccountReasonDto {
  @IsString() @Matches(ACCOUNT_ID_PATTERN) sourceShopId: string;
  @IsString() @Matches(ACCOUNT_ID_PATTERN) targetShopId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(9) @ArrayUnique() @IsIn(ACCOUNT_PERMISSIONS, { each: true }) permissions: AccountPermission[];
}
export class ResetShopAccountPasswordDto extends AccountReasonDto {
  // The service enforces UTF-8 bytes as bcrypt's72-byte boundary is not UTF-16.
  @IsString() @MinLength(6) @MaxLength(72) password: string;
}

export class SaveShopCredentialsDto extends AccountReasonDto {
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(72) password?: string;
  @IsOptional() @IsBoolean() generatePassword?: boolean;
  @ValidateIf((_object, value) => value !== null) @IsString() @Matches(ACCOUNT_ID_PATTERN) expectedUserId: string | null;
  @IsString() @Matches(/^[a-f0-9]{64}$/) version: string;
  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/) requestKey: string;
}
