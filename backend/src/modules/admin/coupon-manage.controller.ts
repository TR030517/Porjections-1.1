/**
 * MJAPP — Admin Coupon Management Controller
 * /admin/coupons — platform coupon CRUD + stats (ADMIN role)
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
import { CouponManageService, CreateCouponDto } from './coupon-manage.service';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Admin Coupons')
@Controller('admin/coupons')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class CouponManageController {
  constructor(private readonly couponManageService: CouponManageService) {}

  @Get()
  @ApiOperation({ summary: 'List coupons (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'keyword', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  async list(@Query() query: any) {
    return this.couponManageService.list(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Coupon claim/redemption stats' })
  async stats() {
    return this.couponManageService.stats();
  }

  @Post()
  @ApiOperation({ summary: 'Create a coupon (platform-wide or shop-scoped)' })
  async create(@Body() dto: CreateCouponDto) {
    return this.couponManageService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a coupon' })
  async update(@Param('id') id: string, @Body() dto: CreateCouponDto) {
    return this.couponManageService.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update coupon status (ACTIVE/PAUSED/DRAFT)' })
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.couponManageService.updateStatus(id, body.status);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a coupon' })
  async remove(@Param('id') id: string) {
    return this.couponManageService.remove(id);
  }
}
