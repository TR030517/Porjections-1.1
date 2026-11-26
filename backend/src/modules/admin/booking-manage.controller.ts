/**
 * MJAPP — BookingManage Controller
 *
 * Admin-only endpoints for global order management:
 * multi-dimensional booking search, full order detail, and dispute resolution.
 * All routes are protected by AuthGuard('jwt') + RolesGuard with @Roles('ADMIN').
 */

import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingManageService } from './booking-manage.service';
import { BookingManageQueryDto, DisputeDto } from './dto/booking-manage.dto';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Admin — Booking Management')
@Controller('admin/bookings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class BookingManageController {
  constructor(private readonly bookingManageService: BookingManageService) {}

  @Get()
  @ApiOperation({
    summary: 'List all bookings',
    description:
      'Multi-dimensional booking search with filtering by status, payment status, shop, user phone, booking number, and date range.',
  })
  async findAll(@Query() query: BookingManageQueryDto) {
    return this.bookingManageService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get booking detail',
    description:
      'Full booking detail including user, shop, service, therapist, review info, and audit logs.',
  })
  async findOne(@Param('id') id: string) {
    return this.bookingManageService.findOne(id);
  }

  @Patch(':id/dispute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle a booking dispute',
    description:
      'Resolve a dispute by issuing a full refund, partial refund, or dismissing the dispute. Records the action in AuditLog.',
  })
  async handleDispute(
    @Param('id') id: string,
    @Body() dto: DisputeDto,
    @GetUser('id') operatorId: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookingManageService.handleDispute(id, dto, operatorId, key);
  }
}
