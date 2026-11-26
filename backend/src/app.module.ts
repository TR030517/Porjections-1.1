/**
 * MJAPP — Root Application Module
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ShopsModule } from './modules/shops/shops.module';
import { ServicesModule } from './modules/services/services.module';
import { TherapistsModule } from './modules/therapists/therapists.module';
import { BookingModule } from './modules/booking/booking.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { MerchantModule } from './modules/merchant/merchant.module';
import { PaymentModule } from './modules/payment/payment.module';
import { AdminModule } from './modules/admin/admin.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { BannersModule } from './modules/banners/banners.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UploadModule } from './modules/upload/upload.module';
import { StudioModule } from './modules/studio/studio.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { AfterSalesModule } from './modules/after-sales/after-sales.module';
import { GiftCardsModule } from './modules/gift-cards/gift-cards.module';
import { StaffModule } from './modules/staff/staff.module';
import { AccountAccessModule } from './modules/account-access/account-access.module';
import { AccountCopyModule } from './modules/account-copy/account-copy.module';
import { SensitiveWordInterceptor } from './common/interceptors/sensitive-word.interceptor';

@Module({
  imports: [
    // Load .env file
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? ['.env'] : ['.env.development', '.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),

    // Application modules
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    ShopsModule,
    ServicesModule,
    TherapistsModule,
    BookingModule,
    FavoritesModule,
    ReviewsModule,
    MerchantModule,
    PaymentModule,
    AdminModule,
    AnnouncementsModule,
    BannersModule,
    CouponsModule,
    NotificationsModule,
    UploadModule,
    StudioModule,
    ReservationsModule,
    AfterSalesModule,
    GiftCardsModule,
    StaffModule,
    AccountAccessModule,
    AccountCopyModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SensitiveWordInterceptor,
    },
  ],
})
export class AppModule {}
