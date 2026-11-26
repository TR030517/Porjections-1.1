import { GetUser } from '../../common/decorators/get-user.decorator';
/**
 * MJAPP — Admin Announcement Controller
 * CRUD for platform announcements. ADMIN role required.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { AnnouncementService } from './announcement.service';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
  AnnouncementQueryDto,
} from './dto/announcement.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('Admin — Announcements')
@ApiBearerAuth()
@Controller('admin/announcements')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new announcement' })
  async create(@Body() dto: CreateAnnouncementDto, @GetUser('id') actor: string) {
    return this.announcementService.create(dto, actor);
  }

  @Get()
  @ApiOperation({ summary: 'List all announcements (paginated)' })
  async findAll(@Query() query: AnnouncementQueryDto) {
    return this.announcementService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get announcement by ID' })
  async findOne(@Param('id') id: string) {
    return this.announcementService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an announcement' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto,
    @GetUser('id') actor: string,
  ) {
    return this.announcementService.update(id, dto, actor);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete an announcement' })
  async remove(@Param('id') id: string, @GetUser('id') actor:string) {
    return this.announcementService.remove(id,actor);
  }
}
