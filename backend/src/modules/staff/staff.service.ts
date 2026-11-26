import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { requireShopAccess, ShopActor, shopAccessId, staffPermissions } from '../../common/shop-access';
import { CreateStaffDto, GrantStaffDto, StaffListDto, StaffPermissionsDto } from './staff.dto';
import { requireRolePassword } from '../../common/validated-password';

const STAFF_USER = { id: true, name: true, email: true, phone: true, role: true, status: true };
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}
  private view(row: any) { return { userId: row.userId.toString(), shopId: row.shopId.toString(), name: row.user?.name ?? '', email: row.user?.email ?? '', phone: row.user?.phone ?? '', accountStatus: row.user?.status ?? 'UNAVAILABLE', status: row.status, permissions: staffPermissions(row.permissions), createdAt: row.createdAt, updatedAt: row.updatedAt, revokedAt: row.revokedAt }; }
  private async audit(tx: any, actor: ShopActor, shopId: bigint, userId: bigint, action: string, permissions?: string[]) {
    await tx.auditLog.create({ data: { operatorId: shopAccessId(actor.id), action, targetType: 'SHOP', targetId: shopId, detail: { staffUserId: userId.toString(), fields: ['staffAccess'], ...(permissions ? { permissions } : {}) } } });
  }
  private async write<T>(shopId: string, actor: ShopActor, work: (tx: any, sid: bigint) => Promise<T>): Promise<T> {
    const sid = shopAccessId(shopId);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx: any) => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM shops WHERE id = ${sid} FOR UPDATE`);
          await requireShopAccess(tx, sid, actor, 'OWNER_ONLY', { write: true });
          return work(tx, sid);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      } catch (error) {
        if ((error as any)?.code === 'P2002') throw new ConflictException('账户或授权已存在，请核对后重试；不会更改已有账户身份');
        if ((error as any)?.code !== 'P2034') throw error;
        if (attempt === 2) throw new ServiceUnavailableException('授权变更冲突，请稍后重试');
      }
    }
    throw new ServiceUnavailableException('请稍后重试');
  }
  async list(shopId: string, actor: ShopActor, query: StaffListDto) {
    const sid = shopAccessId(shopId); await requireShopAccess(this.prisma, sid, actor, 'OWNER_ONLY');
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('无效分页');
    const db = this.prisma as any;
    const [rows, total] = await Promise.all([db.shopStaffGrant.findMany({ where: { shopId: sid }, include: { user: { select: STAFF_USER } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }), db.shopStaffGrant.count({ where: { shopId: sid } })]);
    return { shopId, items: rows.map((row: any) => this.view(row)), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
  async create(shopId: string, actor: ShopActor, body: CreateStaffDto) {
    const permissions = staffPermissions(body.permissions);
    const name = body.name.trim(), email = body.email.trim().toLowerCase();
    if (!name || !email || !/^\+[1-9]\d{7,14}$/.test(body.phone)) throw new BadRequestException('请填写有效员工资料');
    const password = requireRolePassword(body.password, 'STAFF');
    await requireShopAccess(this.prisma, shopAccessId(shopId), actor, 'OWNER_ONLY');
    const passwordHash = await hash(password, 12);
    return this.write(shopId, actor, async (tx, sid) => {
      const user = await tx.user.create({ data: { name, email, phone: body.phone, passwordHash, role: 'STAFF', status: 'ACTIVE' }, select: STAFF_USER });
      const row = await tx.shopStaffGrant.create({ data: { shopId: sid, userId: user.id, createdById: shopAccessId(actor.id), permissions }, include: { user: { select: STAFF_USER } } });
      await this.audit(tx, actor, sid, user.id, 'STAFF_CREATED', permissions);
      return this.view(row);
    });
  }
  async grant(shopId: string, actor: ShopActor, body: GrantStaffDto) {
    const userId = shopAccessId(body.userId), permissions = staffPermissions(body.permissions);
    return this.write(shopId, actor, async (tx, sid) => {
      // The shop mutex always precedes an account lock. Existing accounts are
      // never converted, reset, or searched by a caller-supplied email/phone.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
      const user = await tx.user.findFirst({ where: { id: userId, role: 'STAFF', status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!user) throw new NotFoundException('可授权员工账户不存在');
      const row = await tx.shopStaffGrant.upsert({ where: { shopId_userId: { shopId: sid, userId } }, create: { shopId: sid, userId, createdById: shopAccessId(actor.id), permissions }, update: { permissions, status: 'ACTIVE', revokedAt: null }, include: { user: { select: STAFF_USER } } });
      await this.audit(tx, actor, sid, userId, 'STAFF_GRANTED', permissions); return this.view(row);
    });
  }
  async update(shopId: string, user: string, actor: ShopActor, body: StaffPermissionsDto) {
    const userId = shopAccessId(user), permissions = staffPermissions(body.permissions);
    return this.write(shopId, actor, async (tx, sid) => {
      const row = await tx.shopStaffGrant.findUnique({ where: { shopId_userId: { shopId: sid, userId } } });
      if (!row || row.status !== 'ACTIVE') throw new NotFoundException('有效授权不存在，请使用授权入口重新授予');
      const result = await tx.shopStaffGrant.update({ where: { id: row.id }, data: { permissions }, include: { user: { select: STAFF_USER } } });
      await this.audit(tx, actor, sid, userId, 'STAFF_PERMISSIONS_UPDATED', permissions); return this.view(result);
    });
  }
  async revoke(shopId: string, user: string, actor: ShopActor) {
    const userId = shopAccessId(user);
    return this.write(shopId, actor, async (tx, sid) => {
      const row = await tx.shopStaffGrant.findUnique({ where: { shopId_userId: { shopId: sid, userId } } });
      if (!row) throw new NotFoundException('授权不存在');
      if (row.status === 'REVOKED') return { userId: user, shopId, status: 'REVOKED' };
      await tx.shopStaffGrant.update({ where: { id: row.id }, data: { status: 'REVOKED', permissions: [], revokedAt: new Date() } });
      await this.audit(tx, actor, sid, userId, 'STAFF_REVOKED'); return { userId: user, shopId, status: 'REVOKED' };
    });
  }
}
