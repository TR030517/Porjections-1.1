/**
 * MJAPP — Users Service
 */
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isEmail } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { scalarData } from '../../common/scalar-data';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: bigint | string) {
    const userId = typeof id === 'string' ? BigInt(id) : id;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        emailVerifiedAt: true,
        name: true,
        avatarUrl: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { emailVerifiedAt, ...profile } = user;
    return { ...profile, emailVerified: !!emailVerifiedAt };
  }

  async updateProfile(
    id: bigint | string,
    data: { name?: string; email?: string },
  ) {
    const userId = typeof id === 'string' ? BigInt(id) : id;
    if (Object.prototype.hasOwnProperty.call(data, 'avatarUrl')) throw new BadRequestException('Use /upload/avatar/confirm to update an uploaded avatar');
    const changes = scalarData(data, ['name', 'email']);
    if (changes.name !== undefined) {
      if (typeof changes.name !== 'string' || !changes.name.trim() || changes.name.trim().length > 100) throw new BadRequestException('Invalid display name');
      changes.name = changes.name.trim();
    }
    if (changes.email !== undefined) {
      if (typeof changes.email !== 'string' || changes.email.trim().length > 255 || !isEmail(changes.email.trim())) throw new BadRequestException('Invalid email');
      changes.email = changes.email.trim().toLowerCase();
    }
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id=${userId} FOR UPDATE`);
        const current = await tx.user.findUnique({ where: { id: userId }, select: {
          id: true, phone: true, email: true, emailVerifiedAt: true, name: true, avatarUrl: true, role: true,
        } });
        if (!current) throw new NotFoundException('User not found');
        if (changes.email !== undefined) {
          changes.email = String(changes.email).trim().toLowerCase();
          if (changes.email === current.email) delete changes.email;
          else changes.emailVerifiedAt = null;
        }
        const updated = Object.keys(changes).length
          ? await tx.user.update({ where: { id: userId }, data: changes, select: {
              id: true, phone: true, email: true, emailVerifiedAt: true, name: true, avatarUrl: true, role: true,
            } })
          : current;
        return { id: String(updated.id), phone: updated.phone, email: updated.email, name: updated.name,
          avatarUrl: updated.avatarUrl, role: updated.role, emailVerified: !!updated.emailVerifiedAt };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if ((error as any).code === 'P2002') throw new ConflictException('Email is already in use');
      throw error;
    }
  }
}
