/**
 * MJAPP — Notifications Module
 * Groups FCM (push), Twilio (SMS), and unified notification services.
 * Push delivery remains explicitly disabled without Firebase configuration.
 */

import { Module } from '@nestjs/common';
import { FcmService } from './fcm.service';
import { TwilioService } from './twilio.service';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationWorker } from './notification-worker.service';
import { OrderEmailDelivery } from './order-email-delivery';

@Module({
  controllers: [NotificationsController],
  providers: [FcmService, TwilioService, NotificationService, NotificationInboxService, OrderEmailDelivery, NotificationWorker],
  exports: [FcmService, TwilioService, NotificationService],
})
export class NotificationsModule {}
