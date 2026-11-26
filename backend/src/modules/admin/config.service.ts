/**
 * MJAPP — Admin Config Service
 *
 * Manages platform configuration (key-value) and shop categories.
 * All endpoints require ADMIN role.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';
import {
  UpdateConfigDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/config.dto';

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /* ════════════════════════════════════════════
     Platform Config
     ════════════════════════════════════════════ */

  /**
   * Get all platform configs, optionally filtered by search keyword.
   */
  async findAll(keyword?: string) {
    const where: any = {};
    if (keyword) {
      where.key = { contains: keyword };
    }

    const configs = await this.prisma.platformConfig.findMany({
      where,
      orderBy: { key: 'asc' },
    });

    return configs.map((c) => ({
      id: c.id,
      key: c.key,
      value: c.value,
      type: c.type,
      description: c.description,
      isPublic: c.isPublic,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  /**
   * Update a platform config value by key.
   */
  async update(key: string, dto: UpdateConfigDto, operatorId: string) {
    const config = await this.prisma.platformConfig.findUnique({ where: { key } });
    if (!config) {
      throw new NotFoundException(`Config '${key}' not found`);
    }

    const oldValue = config.value;

    const updated = await this.prisma.platformConfig.update({
      where: { key },
      data: {
        value: dto.value,
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    await this.auditLogService.create({
      action: 'UPDATE_CONFIG',
      targetType: 'PLATFORM_CONFIG',
      targetId: config.id.toString(),
      operatorId,
      detail: {
        key,
        oldValue,
        newValue: dto.value,
      },
    });

    this.logger.log(`Config '${key}' updated`);

    return {
      id: updated.id,
      key: updated.key,
      value: updated.value,
      type: updated.type,
      description: updated.description,
      isPublic: updated.isPublic,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Seed default platform configs (idempotent — skips existing keys).
   */
  async seedDefaults(operatorId: string) {
    const defaults: Array<{
      key: string;
      value: string;
      type: string;
      description: string;
      isPublic: boolean;
    }> = [
      { key: 'commissionRate', value: '8', type: 'NUMBER', description: 'Platform commission rate (%)', isPublic: false },
      { key: 'maxBookingAdvanceDays', value: '30', type: 'NUMBER', description: 'Maximum days in advance for booking', isPublic: true },
      { key: 'minBookingNoticeMinutes', value: '60', type: 'NUMBER', description: 'Minimum notice time before booking (minutes)', isPublic: true },
      { key: 'defaultOpenTime', value: '09:00', type: 'STRING', description: 'Default shop opening time (HH:MM)', isPublic: true },
      { key: 'defaultCloseTime', value: '21:00', type: 'STRING', description: 'Default shop closing time (HH:MM)', isPublic: true },
      { key: 'maxRefundDays', value: '1', type: 'NUMBER', description: 'Maximum days after booking to request refund', isPublic: true },
      { key: 'minPayoutAmount', value: '1000', type: 'NUMBER', description: 'Minimum payout amount (cents)', isPublic: false },
      { key: 'bookingCancelFeePercent', value: '10', type: 'NUMBER', description: 'Cancelation fee (% of booking total)', isPublic: true },
      { key: 'siteName', value: 'Massajoy', type: 'STRING', description: 'Site name displayed to users', isPublic: true },
      { key: 'supportEmail', value: 'support@massajoy.com', type: 'STRING', description: 'Customer support email address', isPublic: true },
      { key: 'maxAppointmentPerSlot', value: '1', type: 'NUMBER', description: 'Max bookings per time slot per shop', isPublic: false },
    ];

    let created = 0;
    let skipped = 0;

    for (const def of defaults) {
      const exists = await this.prisma.platformConfig.findUnique({ where: { key: def.key } });
      if (!exists) {
        await this.prisma.platformConfig.create({ data: def });
        created++;
      } else {
        skipped++;
      }
    }

    await this.auditLogService.create({
      action: 'SEED_CONFIG',
      targetType: 'PLATFORM_CONFIG',
      targetId: '0',
      operatorId,
      detail: { created, skipped, keys: defaults.map((d) => d.key) },
    });

    this.logger.log(`Seeded defaults: ${created} created, ${skipped} skipped`);

    return {
      message: 'Default configs seeded successfully',
      created,
      skipped,
    };
  }

  /* ════════════════════════════════════════════
     Category Management
     ════════════════════════════════════════════ */

  /**
   * Get all categories, ordered by sortOrder.
   */
  async getCategories() {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    return categories.map((c) => ({
      id: c.id.toString(),
      name: c.name,
      nameEn: c.nameEn,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  /**
   * Create a new category.
   */
  async createCategory(dto: CreateCategoryDto, operatorId: string) {
    // Check for duplicate name
    const existing = await this.prisma.category.findFirst({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Category '${dto.name}' already exists`);
    }

    const category = await this.prisma.category.create({
      data: {
        name: dto.name,
        nameEn: dto.nameEn ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLogService.create({
      action: 'CREATE_CATEGORY',
      targetType: 'CATEGORY',
      targetId: category.id.toString(),
      operatorId,
      detail: { name: dto.name, nameEn: dto.nameEn, sortOrder: dto.sortOrder },
    });

    this.logger.log(`Category created: ${dto.name}`);

    return {
      id: category.id.toString(),
      name: category.name,
      nameEn: category.nameEn,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      createdAt: category.createdAt,
    };
  }

  /**
   * Update a category.
   */
  async updateCategory(id: string, dto: UpdateCategoryDto, operatorId: string) {
    const catId = BigInt(id);
    const existing = await this.prisma.category.findUnique({ where: { id: catId } });
    if (!existing) {
      throw new NotFoundException(`Category #${id} not found`);
    }

    // Check name uniqueness if name is being changed
    if (dto.name && dto.name !== existing.name) {
      const dup = await this.prisma.category.findFirst({
        where: { name: dto.name, id: { not: catId } },
      });
      if (dup) {
        throw new ConflictException(`Category '${dto.name}' already exists`);
      }
    }

    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.nameEn !== undefined) updateData.nameEn = dto.nameEn;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    const updated = await this.prisma.category.update({
      where: { id: catId },
      data: updateData,
    });

    await this.auditLogService.create({
      action: 'UPDATE_CATEGORY',
      targetType: 'CATEGORY',
      targetId: id,
      operatorId,
      detail: { before: { name: existing.name }, after: updateData },
    });

    this.logger.log(`Category #${id} updated`);

    return {
      id: updated.id.toString(),
      name: updated.name,
      nameEn: updated.nameEn,
      sortOrder: updated.sortOrder,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Delete (soft) a category — sets isActive to false.
   */
  async deleteCategory(id: string, operatorId: string) {
    const catId = BigInt(id);
    const existing = await this.prisma.category.findUnique({ where: { id: catId } });
    if (!existing) {
      throw new NotFoundException(`Category #${id} not found`);
    }

    // Soft delete
    await this.prisma.category.update({
      where: { id: catId },
      data: { isActive: false },
    });

    await this.auditLogService.create({
      action: 'DELETE_CATEGORY',
      targetType: 'CATEGORY',
      targetId: id,
      operatorId,
      detail: { name: existing.name },
    });

    this.logger.log(`Category #${id} (${existing.name}) soft-deleted`);

    return { message: `Category '${existing.name}' deleted` };
  }
}
