import { contentWrite } from '../../common/content-write';
import { numericId } from '../payment/money';
import { announcementData, contentPage } from '../../common/content-policy';
/**
 * MJAPP — Announcement Service
 * Handles CRUD for platform announcements.
 *
 * All admin methods expect the caller to have passed ADMIN role guard.
 */

import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
  AnnouncementQueryDto,
} from './dto/announcement.dto';

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Create a new announcement */
  async create(dto: CreateAnnouncementDto, actor: string) {
    return contentWrite(this.prisma,'ANNOUNCEMENT',undefined,actor,'ANNOUNCEMENT_CREATE',tx=>tx.announcement.create({data:announcementData({...dto})}));
  }

  /** Find all announcements (admin view: includes soft-deleted) */
  async findAll(query: AnnouncementQueryDto) {
    const page=contentPage(query.page,1,100000), limit=contentPage(query.limit,20,100), type=query.type;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      this.prisma.announcement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /** Get a single announcement by id */
  async findOne(id: bigint | number | string) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: numericId(String(id)), deletedAt: null },
    });
    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }
    return announcement;
  }

  /** Update an announcement */
  async update(id: bigint | number | string, dto: UpdateAnnouncementDto, actor:string) {
    const key=numericId(String(id));
    return contentWrite(this.prisma,'ANNOUNCEMENT',key,actor,'ANNOUNCEMENT_UPDATE',async tx=>{
      const previous=await tx.announcement.findFirst({where:{id:key,deletedAt:null}});
      if(!previous) throw new NotFoundException('Announcement not found');
      return tx.announcement.update({where:{id:key},data:announcementData({...dto},previous)});
    });
  }

  /** Soft-delete an announcement */
  async remove(id: bigint | number | string, actor:string) {
    const key=numericId(String(id));
    return contentWrite(this.prisma,'ANNOUNCEMENT',key,actor,'ANNOUNCEMENT_DELETE',async tx=>{
      if(!await tx.announcement.findFirst({where:{id:key,deletedAt:null}})) throw new NotFoundException('Announcement not found');
      return tx.announcement.update({where:{id:key},data:{deletedAt:new Date(),isActive:false}});
    });
  }
}
