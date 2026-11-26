/**
 * MJAPP — Coupon Public Controller
 * GET /coupons — claimable coupons
 * POST /coupons/:id/claim — claim a coupon
 * GET /users/me/coupons — my coupon wallet
 * POST /coupons/validate — validate a coupon before booking
 */

import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CouponsService } from './coupons.service';
import { GetUser } from '../../common/decorators/get-user.decorator';

export class ValidateCouponDto {
  @IsString()
  couponId: string;

  @IsString()
  shopId: string;

  @IsNumber()
  priceCents: number;
}

@ApiTags('Coupons')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('CUSTOMER')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get('coupons')
  @ApiOperation({ summary: 'List claimable coupons (optionally filtered by shop)' })
  @ApiQuery({ name: 'shopId', required: false, type: String })
  async listClaimable(
    @GetUser('id') userId: string,
    @Query('shopId') shopId?: string,
  ) {
    return this.couponsService.listClaimable(userId, shopId);
  }

  @Post('coupons/:id/claim')
  @ApiOperation({ summary: 'Claim a coupon (transactional, anti-overclaim)' })
  async claim(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.couponsService.claim(userId, id);
  }

  @Get('users/me/coupons')
  @ApiOperation({ summary: 'My coupon wallet (filter by status)' })
  @ApiQuery({ name: 'status', required: false, enum: ['UNUSED', 'USED', 'EXPIRED'] })
  async myCoupons(@GetUser('id') userId: string, @Query('status') status?: string) {
    return this.couponsService.myCoupons(userId, status);
  }

  @Post('coupons/validate')
  @ApiOperation({ summary: 'Validate a coupon against shop + price before booking' })
  async validate(@GetUser('id') userId: string, @Body() dto: ValidateCouponDto) {
    return this.couponsService.validateCoupon({
      userId,
      couponId: dto.couponId,
      shopId: dto.shopId,
      priceCents: dto.priceCents,
    });
  }
}
