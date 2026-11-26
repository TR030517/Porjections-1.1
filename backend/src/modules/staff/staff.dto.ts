import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { SHOP_PERMISSIONS, ShopPermission } from '../../common/shop-access';

export class StaffPermissionsDto {
  @IsArray() @ArrayMaxSize(6) @ArrayUnique() @IsIn(SHOP_PERMISSIONS, { each: true }) permissions: ShopPermission[];
}
export class CreateStaffDto extends StaffPermissionsDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsEmail() @MaxLength(255) email: string;
  @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phone: string;
  // The service applies the shared UTF-8 byte policy, just like password changes.
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}
export class GrantStaffDto extends StaffPermissionsDto {
  @IsString() @Matches(/^[1-9]\d{0,18}$/) userId: string;
}
export class StaffListDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
