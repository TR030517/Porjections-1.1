/**
 * MJAPP — Public Announcements Controller
 * Returns active announcements. Any authenticated user can access.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AnnouncementsService } from './announcements.service';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Announcements')
@ApiBearerAuth()
@Controller('announcements')
@UseGuards(AuthGuard('jwt'))
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  @ApiOperation({ summary: 'Get active announcements for all users' })
  async getActive(@GetUser('role') role: string) {
    return this.announcementsService.getActiveAnnouncements(role);
  }
}
