/**
 * MJAPP — Notifications Controller
 * Endpoints for FCM token registration and notification preferences.
 */

import { Controller, Post, Delete, Get, Patch, Param, Query, Header, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FcmService } from './fcm.service';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationWorker } from './notification-worker.service';
import { InboxQueryDto, OutboxQueryDto, PreferenceDto, RetryNotificationDto } from './dto/notification.dto';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly fcmService: FcmService, private readonly inbox: NotificationInboxService, private readonly worker: NotificationWorker) {}

  @Post('fcm-token')
  @ApiOperation({ summary: 'Register or update FCM push notification token' })
  registerFcmToken(
    @Body() dto: RegisterFcmTokenDto,
    @GetUser('id') userId: string,
    @GetUser('sessionId') sessionId: string,
  ) {
    return this.fcmService.registerToken(userId, sessionId, dto.token);
  }

  @Delete('fcm-token')
  @ApiOperation({ summary: 'Remove a device token belonging to the current login session' })
  unregisterFcmToken(@Body() dto: RegisterFcmTokenDto, @GetUser('id') userId: string, @GetUser('sessionId') sessionId: string) {
    return this.fcmService.unregisterToken(userId, sessionId, dto.token);
  }

  @Get('config')
  @ApiOperation({ summary: 'Read push delivery availability without exposing credentials' })
  config() { return { ...this.fcmService.config(), inboxEnabled: true, worker: this.worker.config() }; }

  @Get('inbox') @Header('Cache-Control', 'no-store')
  list(@GetUser('id') userId: string, @Query() query: InboxQueryDto) { return this.inbox.list(userId, query); }
  @Post('inbox/read-all')
  readAll(@GetUser('id') userId: string) { return this.inbox.readAll(userId); }
  @Post('inbox/:id/read')
  read(@GetUser('id') userId: string, @Param('id') id: string) { return this.inbox.read(userId, id); }
  @Get('preferences') @Header('Cache-Control', 'no-store')
  preferences(@GetUser('id') userId: string) { return this.inbox.preferences(userId); }
  @Patch('preferences')
  updatePreferences(@GetUser('id') userId: string, @Body() body: PreferenceDto) { return this.inbox.updatePreferences(userId, body.pushEnabled); }
  @Get('admin/tasks') @Header('Cache-Control', 'no-store')
  tasks(@GetUser() actor: { id: string; role: string }, @Query() query: OutboxQueryDto) { return this.inbox.tasks(actor, query); }
  @Get('bookings/:bookingId/order-email') @Header('Cache-Control', 'no-store')
  orderEmail(@GetUser() actor: { id: string; role: string }, @Param('bookingId') bookingId: string) { return this.inbox.orderEmail(actor, bookingId); }
  @Post('admin/tasks/:id/retry')
  retry(@GetUser() actor: { id: string; role: string }, @Param('id') id: string, @Body() body: RetryNotificationDto) { return this.inbox.retry(actor, id, body.reason); }
}
