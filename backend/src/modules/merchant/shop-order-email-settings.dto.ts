import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class ShopOrderEmailRevisionDto {
  @IsInt() @Min(0) @Max(2147483645)
  expectedRevision!: number;
}
export class ShopOrderEmailVerificationRequestDto extends ShopOrderEmailRevisionDto {
  @IsString() @MaxLength(255)
  email!: string;
  @IsString() @Matches(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i)
  requestId!: string;
}
export class ShopOrderEmailVerifyDto extends ShopOrderEmailRevisionDto {
  @IsString() @Matches(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i)
  challengeId!: string;
  @IsString() @Matches(/^\d{6}$/)
  code!: string;
}
