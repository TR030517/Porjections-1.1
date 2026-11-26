/**
 * MJAPP — Admin Module
 * Groups all admin-facing APIs (authentication, shop review, audit log,
 * sensitive words, user management, booking management).
 *
 * Note: This module does NOT export JwtModule or AdminService to
 * avoid conflicts with AuthModule. Other modules requiring admin
 * services should use the global PrismaService + JwtStrategy directly.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PassportModule } from '@nestjs/passport';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ShopReviewController } from './shop-review.controller';
import { ShopReviewService } from './shop-review.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { SensitiveWordController } from './sensitive-word.controller';
import { SensitiveWordService } from './sensitive-word.service';
import { UserManageController } from './user-manage.controller';
import { UserManageService } from './user-manage.service';
import { BookingManageController } from './booking-manage.controller';
import { BookingManageService } from './booking-manage.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { BannerManageController } from './banner-manage.controller';
import { BannerManageService } from './banner-manage.service';
import { CouponManageController } from './coupon-manage.controller';
import { CouponManageService } from './coupon-manage.service';
import { PaymentModule } from '../payment/payment.module';
import { PublicIntakeController } from './public-intake.controller';
import { PublicIntakeService } from './public-intake.service';
import { CatalogImportController } from './catalog-import.controller';
import { CatalogImportService } from './catalog-import.service';
import { ShopReadinessController } from './shop-readiness.controller';
import { ShopReadinessService } from './shop-readiness.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AuthModule,
    PaymentModule,
  ],
  controllers: [
    AdminController,
    ShopReviewController,
    AuditLogController,
    UserManageController,
    SensitiveWordController,
    BookingManageController,
    AnnouncementController,
    DashboardController,
    BannerManageController,
    CouponManageController,
    PublicIntakeController,
    CatalogImportController,
    ShopReadinessController,
  ],
  providers: [
    AdminService,
    ShopReviewService,
    AuditLogService,
    UserManageService,
    SensitiveWordService,
    BookingManageService,
    AnnouncementService,
    DashboardService,
    BannerManageService,
    CouponManageService,
    PublicIntakeService,
    CatalogImportService,
    ShopReadinessService,
  ],
  exports: [AdminService, AuditLogService, UserManageService, SensitiveWordService, AnnouncementService],
})
export class AdminModule {}
