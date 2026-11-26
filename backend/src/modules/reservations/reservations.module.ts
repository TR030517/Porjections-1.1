import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { CatalogActionsController } from './catalog-actions.controller';
import { CatalogActionsService } from './catalog-actions.service';
import { ServiceWorkspaceController } from './service-workspace.controller';
import { ServiceWorkspaceService } from './service-workspace.service';
import { BookingCalendarController } from './booking-calendar.controller';
import { BookingCalendarService } from './booking-calendar.service';
import { CalendarActionsController } from './calendar-actions.controller';
import { CalendarActionsService } from './calendar-actions.service';
@Module({ imports: [AuthModule], controllers: [ReservationsController, CatalogActionsController, ServiceWorkspaceController, BookingCalendarController, CalendarActionsController], providers: [ReservationsService, CatalogActionsService, ServiceWorkspaceService, BookingCalendarService, CalendarActionsService], exports: [ReservationsService] })
export class ReservationsModule {}
