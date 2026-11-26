import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export const CASE_TYPES = [
  "REFUND",
  "RESCHEDULE",
  "COMPLAINT",
  "OTHER",
] as const;
export const CASE_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export const CASE_ACTIONS = [
  "ACCEPT",
  "WAIT_FOR_CUSTOMER",
  "RESUME",
  "REJECT",
  "RESOLVE",
  "WITHDRAW",
] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];
export type CaseActor = { id: string; role: string };

export class CreateAfterSalesDto {
  @IsString() @Matches(/^[1-9]\d{0,18}$/) bookingId: string;
  @IsIn(CASE_TYPES) type: (typeof CASE_TYPES)[number];
  @IsString() @MinLength(1) @MaxLength(2000) reason: string;
  @IsOptional() @IsInt() @Min(1) @Max(99999999) requestedAmountCents?: number;
}
export class AfterSalesListDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/) shopId?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/) bookingId?: string;
  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(30) @Matches(/^[^\u0000-\u001f\u007f]+$/)
  bookingNo?: string;
  @IsOptional() @IsIn(CASE_STATUSES) status?: (typeof CASE_STATUSES)[number];
  @IsOptional() @IsIn(CASE_TYPES) type?: (typeof CASE_TYPES)[number];
}
export class AfterSalesVersionDto {
  @IsInt() @Min(1) @Max(2147483646) version: number;
}
export class AfterSalesNoteDto extends AfterSalesVersionDto {
  @IsString() @MinLength(1) @MaxLength(2000) content: string;
  @IsOptional() @IsIn(["PUBLIC", "INTERNAL"]) visibility?:
    | "PUBLIC"
    | "INTERNAL";
}
export class AfterSalesTransitionDto extends AfterSalesVersionDto {
  @IsIn(CASE_ACTIONS) action: CaseAction;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
