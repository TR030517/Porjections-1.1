/**
 * MJAPP — AuditLog Service
 *
 * Service for recording and querying admin audit logs.
 * Logs track every admin action (approve/reject shop, disable user, etc.)
 * for accountability and compliance.
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ACTION_PATTERN, AUDIT_ID_PATTERN, AUDIT_TARGET_PATTERN } from './dto/audit-log-query.dto';

interface AuditQuery {
  targetType?: string;
  action?: string;
  targetId?: string;
  operatorId?: string;
  startDate?: string;
  endDate?: string;
  page?: number | string;
  limit?: number | string;
}

const MAX_ID = 9223372036854775807n;
const SAFE_FIELDS = new Set([
  'name', 'shortName', 'category', 'industryId', 'stateId', 'cityId', 'timezone',
  'businessHours', 'businessPeriod', 'workDate', 'address', 'addr', 'phones',
  'contactName', 'description', 'imageUrls', 'features', 'serviceIds', 'priceCents',
  'durationMin', 'isActive', 'sortOrder', 'ownerId', 'role', 'avatarUrl', 'level',
  'intro', 'title', 'type', 'content', 'startDate', 'endDate', 'amount', 'threshold',
  'merchantShortLink', 'validityDays', 'useTimes', 'priceOptions', 'status',
  'gender', 'experienceYears', 'specialties', 'regionId', 'parentId', 'shortLink',
  'loginName', 'loginBinding', 'linkedAccountAccess', 'passwordReset',
]);
const SAFE_STATUSES = new Set([
  'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ACTIVE', 'DISABLED', 'DELETED',
  'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED', 'UNPAID', 'PAID',
  'PARTIALLY_REFUNDED', 'NORMAL', 'CLOSED', 'PAUSED', '正常', '关闭',
  'OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'WITHDRAWN', 'EXHAUSTED', 'EXPIRED', 'VOIDED',
]);
const auditSelect = {
  id: true, action: true, targetType: true, targetId: true, operatorId: true,
  detail: true, createdAt: true,
} satisfies Prisma.AuditLogSelect;

function boundedInteger(value: unknown, fallback: number, maximum: number, field: string) {
  if (value === undefined) return fallback;
  if (!(typeof value === 'number' && Number.isSafeInteger(value)) &&
      !(typeof value === 'string' && /^[1-9]\d*$/.test(value))) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new BadRequestException(`${field} is outside the allowed range`);
  }
  return number;
}

function identifier(value: unknown, field: string) {
  if (typeof value !== 'string' || !AUDIT_ID_PATTERN.test(value) || BigInt(value) > MAX_ID) {
    throw new BadRequestException(`${field} must be a positive signed BigInt ID`);
  }
  return BigInt(value);
}

function code(value: unknown, pattern: RegExp, field: string) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new BadRequestException(`${field} contains unsupported characters or length`);
  }
  return value;
}

function utcDay(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD in UTC`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} must be a valid calendar date`);
  }
  return date;
}

// Never return arbitrary JSON values, free-text reasons, names, contacts or secrets.
function safeDetail(value: unknown) {
  const result: {
    fields?: string[]; reasonRecorded?: boolean; previousStatus?: string; newStatus?: string;
    revokedSessions?: number; internalZeroBalance?: boolean; externalPaymentsEnabled?: boolean;
  } = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const detail = value as Record<string, unknown>;
  if (Array.isArray(detail.fields)) {
    result.fields = [...new Set(detail.fields.filter((field): field is string =>
      typeof field === 'string' && SAFE_FIELDS.has(field)))].slice(0, 50);
  }
  if ((typeof detail.reason === 'string' && detail.reason.trim()) || detail.reasonRecorded === true) result.reasonRecorded = true;
  for (const key of ['previousStatus', 'newStatus'] as const) {
    if (typeof detail[key] === 'string' && SAFE_STATUSES.has(detail[key])) result[key] = detail[key];
  }
  if (typeof detail.revokedSessions === 'number' && Number.isSafeInteger(detail.revokedSessions) && detail.revokedSessions >= 0) {
    result.revokedSessions = detail.revokedSessions;
  }
  for (const key of ['internalZeroBalance', 'externalPaymentsEnabled'] as const) {
    if (typeof detail[key] === 'boolean') result[key] = detail[key];
  }
  return result;
}

function publicLog(item: Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>) {
  return {
    id: item.id.toString(),
    action: AUDIT_ACTION_PATTERN.test(item.action) ? item.action : 'OTHER',
    targetType: AUDIT_TARGET_PATTERN.test(item.targetType) ? item.targetType : 'OTHER',
    targetId: item.targetId.toString(),
    operatorId: item.operatorId.toString(),
    operator: { id: item.operatorId.toString() },
    detail: safeDetail(item.detail),
    createdAt: item.createdAt,
  };
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an audit log entry.
   *
   * @param dto.action       Action performed (e.g. 'APPROVE', 'REJECT', 'DISABLE')
   * @param dto.targetType   Entity type ('SHOP', 'USER', 'BOOKING')
   * @param dto.targetId     Entity ID (string, will be parsed to BigInt)
   * @param dto.operatorId   Admin user ID who performed the action
   * @param dto.detail       Optional JSON payload with extra context
   */
  async create(dto: {
    action: string;
    targetType: string;
    targetId: string;
    operatorId: string;
    detail?: Record<string, any>;
  }) {
    const log = await this.prisma.auditLog.create({
      data: {
        action: dto.action,
        targetType: dto.targetType,
        targetId: BigInt(dto.targetId),
        operatorId: BigInt(dto.operatorId),
        detail: dto.detail ?? {},
      },
    });

    this.logger.log(`AuditLog: ${dto.action} on ${dto.targetType}#${dto.targetId} by admin#${dto.operatorId}`);
    return log;
  }

  /**
   * Query audit logs with filtering and pagination.
   */
  async findAll(query: AuditQuery) {
    const page = boundedInteger(query.page, 1, 100000, 'page');
    const limit = boundedInteger(query.limit, 20, 100, 'limit');
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};
    if (query.targetType !== undefined) where.targetType = code(query.targetType, AUDIT_TARGET_PATTERN, 'targetType');
    if (query.action !== undefined) where.action = code(query.action, AUDIT_ACTION_PATTERN, 'action');
    if (query.targetId !== undefined) where.targetId = identifier(query.targetId, 'targetId');
    if (query.operatorId !== undefined) where.operatorId = identifier(query.operatorId, 'operatorId');
    const start = query.startDate === undefined ? undefined : utcDay(query.startDate, 'startDate');
    const end = query.endDate === undefined ? undefined : utcDay(query.endDate, 'endDate');
    if (start && end && start > end) throw new BadRequestException('startDate must not be after endDate');
    if (start || end) where.createdAt = {
      ...(start ? { gte: start } : {}),
      ...(end ? { lte: new Date(end.getTime() + 86400000 - 1) } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: auditSelect,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items.map(publicLog),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find audit logs for a specific target entity.
   */
  async findByTarget(targetType: string, targetId: string, requestedLimit?: number | string) {
    const limit = boundedInteger(requestedLimit, 20, 100, 'limit');
    const type = code(targetType, AUDIT_TARGET_PATTERN, 'targetType');
    const id = identifier(targetId, 'targetId');
    const items = await this.prisma.auditLog.findMany({
      where: {
        targetType: type,
        targetId: id,
      },
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: auditSelect,
    });

    return items.map(publicLog);
  }
}
