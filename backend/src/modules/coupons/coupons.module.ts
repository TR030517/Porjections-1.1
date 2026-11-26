/**
 * MJAPP — Coupon Module
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [PrismaModule],
  controllers: [CouponsController],
  providers: [CouponsService, RolesGuard],
  exports: [CouponsService],
})
export class CouponsModule {}
