import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ReservationsService } from './reservations.service';
import { Actor } from './reservation-validation';
import { ShopPaymentPolicyDto, ShopBookingSettingsDto, TherapistScheduleDto, MenuCatalogQueryDto, ProjectCatalogQueryDto, StaffingTargetDto } from './reservation.dto';
import { CreateVariantDto, UpdateVariantDto, CreateShiftDto, UpdateShiftDto, CreateTimeOffDto, UpdateTimeOffDto, CreateRoomDto, UpdateRoomDto, CreateMaintenanceDto, UpdateMaintenanceDto, ServicePolicyDto, ReservationHoursDto } from './reservation.dto';
import { CreateServiceAddOnDto, UpdateServiceAddOnDto } from './service-addon.dto';

@Controller('reservation-admin/shops/:shopId')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT', 'STAFF')
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}
  @Get('menu-catalog')
  @Roles('ADMIN', 'MERCHANT')
  @Header('Cache-Control', 'no-store')
  menuCatalog(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Query() query: MenuCatalogQueryDto) {
    return this.service.menuCatalog(shopId, actor, query);
  }
  @Get('project-catalog')
  @Roles('ADMIN', 'MERCHANT', 'STAFF')
  @Header('Cache-Control', 'no-store')
  projectCatalog(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Query() query: ProjectCatalogQueryDto) {
    return this.service.projectCatalog(shopId, actor, query);
  }
  @Get('config')
  config(@Param('shopId') shopId: string, @GetUser() actor: Actor) { return this.service.config(shopId, actor); }
  @Get('booking-settings')
  bookingSettingsView(@Param('shopId') shopId: string, @GetUser() actor: Actor) { return this.service.bookingSettingsView(shopId, actor); }
  @Patch('booking-settings')
  bookingSettings(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: ShopBookingSettingsDto) { return this.service.bookingSettings(shopId, actor, body); }
  @Get('staffing')
  @Header('Cache-Control', 'no-store')
  staffing(@Param('shopId') shopId: string, @GetUser() actor: Actor) { return this.service.staffing(shopId, actor); }
  @Patch('staffing')
  @Header('Cache-Control', 'no-store')
  setStaffing(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: StaffingTargetDto) {
    return this.service.setStaffing(shopId, actor, body);
  }
  @Post('add-ons')
  createAddOn(@Param('shopId') shopId:string,@GetUser() actor:Actor,@Body() body:CreateServiceAddOnDto){return this.service.mutateAddOn(shopId,actor,body);}
  @Patch('add-ons/:id')
  updateAddOn(@Param('shopId') shopId:string,@Param('id') addOnId:string,@GetUser() actor:Actor,@Body() body:UpdateServiceAddOnDto){return this.service.mutateAddOn(shopId,actor,body,addOnId);}
  @Delete('add-ons/:id')
  disableAddOn(@Param('shopId') shopId:string,@Param('id') addOnId:string,@GetUser() actor:Actor){return this.service.mutateAddOn(shopId,actor,{},addOnId,true);}
  @Patch('payment-policy')
  @Roles('ADMIN', 'MERCHANT')
  paymentPolicy(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: ShopPaymentPolicyDto) { return this.service.paymentPolicy(shopId, actor, body); }
  @Patch('hours')
  hours(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: ReservationHoursDto) { return this.service.hours(shopId, actor, body); }
  @Patch('services/:id/policy')
  policy(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor, @Body() body: ServicePolicyDto) {
    return this.service.policy(shopId, id, actor, body);
  }
  @Post('variants')
  createVariant(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: CreateVariantDto) {
    return this.service.mutate(shopId, actor, 'variants', body);
  }
  @Patch('variants/:id')
  updateVariant(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor, @Body() body: UpdateVariantDto) {
    return this.service.mutate(shopId, actor, 'variants', body, id);
  }
  @Delete('variants/:id')
  deleteVariant(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor) {
    return this.service.mutate(shopId, actor, 'variants', {}, id, true);
  }
  @Patch('therapists/:id/schedule')
  schedule(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor, @Body() body: TherapistScheduleDto) {
    return this.service.schedule(shopId, id, actor, body);
  }
  @Post('shifts')
  createShift(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: CreateShiftDto) {
    return this.service.mutate(shopId, actor, 'shifts', body);
  }
  @Patch('shifts/:id')
  updateShift(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor, @Body() body: UpdateShiftDto) {
    return this.service.mutate(shopId, actor, 'shifts', body, id);
  }
  @Delete('shifts/:id')
  deleteShift(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor) {
    return this.service.mutate(shopId, actor, 'shifts', {}, id, true);
  }
  @Post('time-off')
  createTimeOff(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: CreateTimeOffDto) {
    return this.service.mutate(shopId, actor, 'time-off', body);
  }
  @Patch('time-off/:id')
  updateTimeOff(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor, @Body() body: UpdateTimeOffDto) {
    return this.service.mutate(shopId, actor, 'time-off', body, id);
  }
  @Delete('time-off/:id')
  deleteTimeOff(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor) {
    return this.service.mutate(shopId, actor, 'time-off', {}, id, true);
  }
  @Post('rooms')
  createRoom(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: CreateRoomDto) {
    return this.service.mutate(shopId, actor, 'rooms', body);
  }
  @Patch('rooms/:id')
  updateRoom(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor, @Body() body: UpdateRoomDto) {
    return this.service.mutate(shopId, actor, 'rooms', body, id);
  }
  @Delete('rooms/:id')
  deleteRoom(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor) {
    return this.service.mutate(shopId, actor, 'rooms', {}, id, true);
  }
  @Post('maintenance')
  createMaintenance(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: CreateMaintenanceDto) {
    return this.service.mutate(shopId, actor, 'maintenance', body);
  }
  @Patch('maintenance/:id')
  updateMaintenance(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor, @Body() body: UpdateMaintenanceDto) {
    return this.service.mutate(shopId, actor, 'maintenance', body, id);
  }
  @Delete('maintenance/:id')
  deleteMaintenance(@Param('shopId') shopId: string, @Param('id') id: string, @GetUser() actor: Actor) {
    return this.service.mutate(shopId, actor, 'maintenance', {}, id, true);
  }
}
