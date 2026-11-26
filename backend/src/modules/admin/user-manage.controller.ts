/**
 * MJAPP — UserManage Controller
 *
 * Admin-only endpoints for managing platform users.
 * All routes are protected by AuthGuard('jwt') + RolesGuard with @Roles('ADMIN').
 *
 * Endpoints:
 *   GET    /admin/users          — Paginated user list (search, status filter)
 *   GET    /admin/users/:id      — User detail (profile + bookings + reviews)
 *   PATCH  /admin/users/:id/status — Update user status (ACTIVE/SUSPENDED/DELETED)
 */

import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserManageService } from './user-manage.service';
import { UserManageQueryDto, UpdateUserStatusDto } from './dto/user-manage.dto';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Admin — User Management')
@Controller('admin/users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class UserManageController {
  constructor(private readonly userManageService: UserManageService) {}

  @Get()
  @ApiOperation({
    summary: 'List users',
    description:
      'Paginated user list with optional search (phone/email) and status filter (ACTIVE/SUSPENDED/DELETED).',
  })
  async findAll(@Query() query: UserManageQueryDto) {
    return this.userManageService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get user detail',
    description:
      'Full user profile including basic info, merchant profile (if any), recent 10 bookings, and recent reviews.',
  })
  async findOne(@Param('id') id: string) {
    return this.userManageService.findOne(id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update user status',
    description:
      'Change user status to ACTIVE, SUSPENDED, or DELETED. Records the action in AuditLog for accountability.',
  })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @GetUser('id') operatorId: string,
  ) {
    return this.userManageService.updateStatus(id, dto, operatorId);
  }
}
