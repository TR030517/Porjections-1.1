/**
 * MJAPP — Dashboard Controller
 * Admin dashboard statistics endpoints.
 * All routes require ADMIN role.
 */

import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Admin Dashboard')
@Controller('admin/dashboard')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregated dashboard statistics' })
  @ApiQuery({
    name: 'range',
    required: false,
    enum: ['day', 'week', 'month', 'year'],
    description: 'Time aggregation window (default: week)',
  })
  async getStats(
    @Query('range') range: 'day' | 'week' | 'month' | 'year' = 'week',
  ) {
    return this.dashboardService.getStats(range);
  }
}
