import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
const raw=({obj,key}:{obj:Record<string,unknown>;key:string})=>obj[key];
export class CreateServiceAddOnDto {
  @Transform(raw) @IsString() @Matches(/^[1-9]\d{0,18}$/) serviceId!:string;
  @Transform(raw) @IsString() @MaxLength(100) name!:string;
  @IsOptional() @Transform(raw) @IsString() @MaxLength(1000) description?:string|null;
  @Transform(raw) @IsInt() @Min(0) @Max(10000000) priceCents!:number;
  @Transform(raw) @IsIn(['usd']) currency!:'usd';
  @Transform(raw) @IsBoolean() isActive!:boolean;
  @Transform(raw) @IsInt() @Min(0) @Max(10000) sortOrder!:number;
}
export class UpdateServiceAddOnDto extends PartialType(CreateServiceAddOnDto) {}
