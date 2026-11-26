import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
export class OfflineReceiptDto {
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,80}$/) requestKey!: string;
  @IsInt() @Min(1) @Max(99999999) amountCents!: number;
  @IsIn(['CASH', 'EXTERNAL_TERMINAL', 'OTHER']) method!: string;
  @IsString() @MaxLength(30) occurredAt!: string;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
export class ReverseReceiptDto {
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,80}$/) requestKey!: string;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
