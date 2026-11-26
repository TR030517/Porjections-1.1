import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { OUTBOX_STATUSES } from '../notification.rules';
export class InboxQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsIn(['true', 'false']) unreadOnly?: string;
}
export class OutboxQueryDto extends InboxQueryDto {
  @IsOptional() @IsIn([...OUTBOX_STATUSES]) status?: string;
  @IsOptional() @IsIn(['IN_APP', 'PUSH', 'SMS', 'EMAIL']) channel?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z_]{1,40}$/) topic?: string;
}
export class PreferenceDto {
  // Consent requires a JSON boolean; implicit conversion turns even 'false' into true.
  @Transform(({ obj, key }) => obj[key], { toClassOnly: true })
  @IsBoolean()
  pushEnabled!: boolean;
}
export class RetryNotificationDto { @IsString() @MinLength(5) @MaxLength(500) reason!: string; }
