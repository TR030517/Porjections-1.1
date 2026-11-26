import { GetUser } from '../../common/decorators/get-user.decorator';
/**
 * MJAPP — Admin Banner Management Controller
 * /admin/banners CRUD — ADMIN role only
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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { BannerManageService, CreateBannerDto } from './banner-manage.service';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Admin Banners')
@Controller('admin/banners')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class BannerManageController {
  constructor(private readonly bannerManageService: BannerManageService) {}

  @Get()
  @ApiOperation({ summary: 'List banners (paginated, optional keyword)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'keyword', required: false, type: String })
  async list(@Query() query: any) {
    return this.bannerManageService.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a banner' })
  async create(@Body() dto: CreateBannerDto, @GetUser('id') actor:string) {
    return this.bannerManageService.create(dto,actor);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a banner' })
  async update(@Param('id') id: string, @Body() dto: CreateBannerDto, @GetUser('id') actor:string) {
    return this.bannerManageService.update(id, dto, actor);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Toggle banner active status' })
  async toggle(@Param('id') id: string, @GetUser('id') actor:string) {
    return this.bannerManageService.toggle(id,actor);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a banner' })
  async remove(@Param('id') id: string, @GetUser('id') actor:string) {
    return this.bannerManageService.remove(id,actor);
  }
}
