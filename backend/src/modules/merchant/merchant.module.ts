/**
 * MJAPP — Merchant Module
 * Groups all merchant-facing APIs (onboarding, shop mgmt, therapist mgmt, dashboard, stripe)
 */

import { Module } from '@nestjs/common';
import { MerchantController } from './merchant.controller';
import { MerchantService } from './merchant.service';
import { BookingModule } from '../booking/booking.module';
import { MerchantCouponController } from './merchant-coupon.controller';
import { MerchantCouponService } from './merchant-coupon.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShopOrderEmailSettingsController } from './shop-order-email-settings.controller';
import { ShopOrderEmailSettingsService } from './shop-order-email-settings.service';
import { ShopOrderEmailVerificationDelivery } from './shop-order-email-settings.delivery';

@Module({
  imports: [PrismaModule, BookingModule],
  controllers: [MerchantController, MerchantCouponController, ShopOrderEmailSettingsController],
  providers: [MerchantService, MerchantCouponService, ShopOrderEmailSettingsService, ShopOrderEmailVerificationDelivery],
  exports: [MerchantService],
})
export class MerchantModule {}
