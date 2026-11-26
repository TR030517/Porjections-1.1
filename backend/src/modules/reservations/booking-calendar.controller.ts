import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Actor } from './reservation-validation';
import { BookingCalendarService } from './booking-calendar.service';

@Controller('reservation-admin/shops/:shopId/calendar-events')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT', 'STAFF')
export class BookingCalendarController {
  constructor(private readonly service: BookingCalendarService) {}
  @Get() @Header('Cache-Control', 'no-store')
  events(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Query() query: Record<string, unknown>) {
    return this.service.events(shopId, actor, query);
  }
}
