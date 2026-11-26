/**
 * MJAPP — Admin Config Controller
 *
 * Platform configuration and category management.
 * All routes are under /admin/config and require ADMIN role.
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ConfigService } from './config.service';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import {
  UpdateConfigDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/config.dto';

@ApiTags('Admin / Config')
@Controller('admin/config')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class AdminConfigController {
  constructor(private readonly configService: ConfigService) {}

  /* ════════════════════════════════════════════
     Platform Config
     ════════════════════════════════════════════ */

  @Get()
  @ApiOperation({ summary: 'Get all platform configs (optional keyword filter)' })
  @ApiQuery({ name: 'keyword', required: false, description: 'Filter by key (contains)' })
  async findAll(@Query('keyword') keyword?: string) {
    return this.configService.findAll(keyword);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Update a platform config value by key' })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateConfigDto,
    @GetUser('id') operatorId: string,
  ) {
    return this.configService.update(key, dto, operatorId);
  }

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seed default platform configs (idempotent)' })
  async seedDefaults(@GetUser('id') operatorId: string) {
    return this.configService.seedDefaults(operatorId);
  }

  /* ════════════════════════════════════════════
     Category Management
     ════════════════════════════════════════════ */

  @Get('categories')
  @ApiOperation({ summary: 'Get all categories' })
  async getCategories() {
    return this.configService.getCategories();
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new category' })
  async createCategory(
    @Body() dto: CreateCategoryDto,
    @GetUser('id') operatorId: string,
  ) {
    return this.configService.createCategory(dto, operatorId);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a category' })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @GetUser('id') operatorId: string,
  ) {
    return this.configService.updateCategory(id, dto, operatorId);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a category (sets isActive=false)' })
  async deleteCategory(
    @Param('id') id: string,
    @GetUser('id') operatorId: string,
  ) {
    return this.configService.deleteCategory(id, operatorId);
  }
}
