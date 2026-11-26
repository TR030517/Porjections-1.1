import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

export const AUDIT_ID_PATTERN = /^[1-9]\d{0,18}$/;
export const AUDIT_ACTION_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
export const AUDIT_TARGET_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,49}$/;

export class AuditLogTargetQueryDto {
  @ApiPropertyOptional({ description: 'Maximum records, 1–100', default: 20 })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{0,2}$/)
  limit?: string = '20';
}

export class AuditLogTargetParamsDto {
  @IsString()
  @Matches(AUDIT_TARGET_PATTERN)
  targetType: string;

  @IsString()
  @Matches(AUDIT_ID_PATTERN)
  targetId: string;
}

export class AuditLogQueryDto extends AuditLogTargetQueryDto {
  @ApiPropertyOptional({ description: 'Exact target code, e.g. SHOP or stores' })
  @IsOptional()
  @IsString()
  @Matches(AUDIT_TARGET_PATTERN)
  targetType?: string;

  @ApiPropertyOptional({ description: 'Exact action code' })
  @IsOptional()
  @IsString()
  @Matches(AUDIT_ACTION_PATTERN)
  action?: string;

  @ApiPropertyOptional({ description: 'Positive signed BigInt entity ID' })
  @IsOptional()
  @IsString()
  @Matches(AUDIT_ID_PATTERN)
  targetId?: string;

  @ApiPropertyOptional({ description: 'Positive signed BigInt operator ID' })
  @IsOptional()
  @IsString()
  @Matches(AUDIT_ID_PATTERN)
  operatorId?: string;

  @ApiPropertyOptional({ description: 'First UTC date, YYYY-MM-DD (inclusive)' })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{3}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  startDate?: string;

  @ApiPropertyOptional({ description: 'Last UTC date, YYYY-MM-DD (inclusive)' })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{3}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  endDate?: string;

  @ApiPropertyOptional({ description: 'Page, 1–100000', default: 1 })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{0,5}$/)
  page?: string = '1';
}
