/**
 * MJAPP — Booking Module
 */
import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { AssistedBookingController } from './assisted-booking.controller';
import { SettlementService } from './settlement.service';
import { PaymentModule } from '../payment/payment.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CouponsModule } from '../coupons/coupons.module';

@Module({
  imports: [PaymentModule, NotificationsModule, CouponsModule],
  controllers: [BookingController, AssistedBookingController],
  providers: [BookingService, SettlementService],
  exports: [BookingService],
})
export class BookingModule {}
