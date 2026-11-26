/**
 * MJAPP — Public Announcements Service
 * Returns active announcements visible to all authenticated users.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get active announcements — visible to any user (no admin role required) */
  async getActiveAnnouncements(role: string) {
    const now = new Date();
    const scope = role === 'ADMIN' ? ['ALL','USERS','MERCHANTS'] : ['MERCHANT','STAFF'].includes(role) ? ['ALL','MERCHANTS'] : ['ALL','USERS'];
    // Lexical ordering cannot represent URGENT > IMPORTANT > INFO. Read each bounded priority bucket explicitly.
    const buckets = await Promise.all(['URGENT','IMPORTANT','INFO'].map(type => this.prisma.announcement.findMany({
      where: { type, isActive: true, deletedAt: null, scope: { in: scope }, startAt: { lte: now }, OR: [{ endAt: null }, { endAt: { gt: now } }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
      select: { id:true,title:true,content:true,type:true,scope:true,isActive:true,createdAt:true,updatedAt:true,startAt:true,endAt:true },
    })));
    return buckets.flat().slice(0,50);

  }
}
