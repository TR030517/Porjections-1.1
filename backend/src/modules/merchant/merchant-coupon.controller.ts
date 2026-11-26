/**
 * MJAPP — Merchant Coupon Management Controller
 * /merchant/shops/:shopId/coupons — shop-scoped coupon CRUD (MERCHANT role)
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MerchantCouponService, MerchantCouponDto, MerchantCouponStatusDto } from './merchant-coupon.service';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Merchant Coupons')
@Controller('merchant/shops/:shopId/coupons')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT')
@ApiBearerAuth()
export class MerchantCouponController {
  constructor(private readonly merchantCouponService: MerchantCouponService) {}

  @Get()
  @ApiOperation({ summary: 'List coupons for my shop' })
  async list(@GetUser('id') userId: string, @Param('shopId') shopId: string, @GetUser('role') actorRole: string) {
    return this.merchantCouponService.list(userId, shopId, actorRole);
  }

  @Post()
  @ApiOperation({ summary: 'Create a shop-scoped coupon' })
  async create(
    @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Body() dto: MerchantCouponDto,
    @GetUser('role') actorRole: string,
  ) {
    return this.merchantCouponService.create(userId, shopId, dto, actorRole);
  }

  @Patch(':couponId')
  @ApiOperation({ summary: 'Update a shop coupon' })
  async update(
    @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Param('couponId') couponId: string,
    @Body() dto: MerchantCouponDto,
    @GetUser('role') actorRole: string,
  ) {
    return this.merchantCouponService.update(userId, shopId, couponId, dto, actorRole);
  }

  @Patch(':couponId/status')
  @ApiOperation({ summary: 'Update coupon status (ACTIVE/PAUSED/DRAFT)' })
  async updateStatus(
    @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Param('couponId') couponId: string,
    @Body() body: MerchantCouponStatusDto,
    @GetUser('role') actorRole: string,
  ) {
    return this.merchantCouponService.updateStatus(userId, shopId, couponId, body.status, actorRole);
  }

  @Delete(':couponId')
  @ApiOperation({ summary: 'Soft delete a shop coupon' })
  async remove(
    @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Param('couponId') couponId: string,
    @GetUser('role') actorRole: string,
  ) {
    return this.merchantCouponService.remove(userId, shopId, couponId, actorRole);
  }
}
