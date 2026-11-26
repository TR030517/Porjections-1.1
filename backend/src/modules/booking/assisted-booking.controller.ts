import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { BookingService } from './booking.service';
import { AssistedBookingCustomerQueryDto, AssistedBookingQuoteDto, CreateAssistedBookingDto, GuestAssistedBookingQuoteDto, CreateGuestAssistedBookingDto, AssistedBookingSlotsQueryDto } from './dto/booking.dto';

@ApiTags('Merchant assisted bookings')
@Controller('merchant')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT', 'STAFF')
@ApiBearerAuth()
export class AssistedBookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Get('shops/:shopId/customers')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Find verified customers with prior bookings at this shop' })
  customers(@Param('shopId') shopId: string, @Query() query: AssistedBookingCustomerQueryDto, @GetUser() actor: any) {
    return this.bookingService.assistedBookingCustomers(actor, shopId, query.search);
  }

  @Get('shops/:shopId/booking-services')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List bookable services and active variants for an assisted booking' })
  services(@Param('shopId') shopId: string, @GetUser() actor: any) {
    return this.bookingService.assistedBookingServices(actor, shopId);
  }
  @Get('shops/:shopId/booking-therapists') @Header('Cache-Control', 'no-store')
  therapists(@Param('shopId') shopId: string, @GetUser() actor: any) {
    return this.bookingService.assistedBookingTherapists(actor, shopId);
  }
  @Get('shops/:shopId/assisted-slots') @Header('Cache-Control', 'no-store')
  slots(@Param('shopId') shopId: string, @Query() dto: AssistedBookingSlotsQueryDto, @GetUser() actor: any) {
    return this.bookingService.getAssistedBookingSlots(actor, { ...dto, shopId });
  }

  @Post('shops/:shopId/assisted-quote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Quote a manual offline booking for an existing verified customer' })
  quote(@Param('shopId') shopId: string, @Body() dto: AssistedBookingQuoteDto, @GetUser() actor: any) {
    return this.bookingService.quoteAssistedBooking(actor, { ...dto, shopId });
  }

  @Post('shops/:shopId/assisted-bookings')
  @ApiOperation({ summary: 'Create a manual PAY_AT_STORE booking for an existing verified customer' })
  create(@Param('shopId') shopId: string, @Body() dto: CreateAssistedBookingDto, @GetUser() actor: any) {
    return this.bookingService.createAssistedBooking(actor, { ...dto, shopId });
  }
  @Post('shops/:shopId/guest-assisted-quote') @HttpCode(200) @Header('Cache-Control', 'no-store')
  guestQuote(@Param('shopId') shopId: string, @Body() dto: GuestAssistedBookingQuoteDto, @GetUser() actor: any) {
    return this.bookingService.quoteGuestAssistedBooking(actor, { ...dto, shopId });
  }
  @Post('shops/:shopId/guest-assisted-bookings') @Header('Cache-Control', 'no-store')
  guestCreate(@Param('shopId') shopId: string, @Body() dto: CreateGuestAssistedBookingDto, @GetUser() actor: any) {
    return this.bookingService.createGuestAssistedBooking(actor, { ...dto, shopId });
  }
  @Get('shops/:shopId/guest-assisted-bookings/operations/:requestKey') @Header('Cache-Control', 'no-store')
  guestOperation(@Param('shopId') shopId: string, @Param('requestKey') requestKey: string, @GetUser() actor: any) {
    return this.bookingService.guestAssistedBookingOperation(actor, shopId, requestKey);
  }
  @Post('shops/:shopId/guest-assisted-bookings/operations/:requestKey/reconcile') @Header('Cache-Control', 'no-store')
  guestReconcile(@Param('shopId') shopId: string, @Param('requestKey') requestKey: string, @Body() body: unknown, @GetUser() actor: any) {
    return this.bookingService.reconcileGuestAssistedBookingOperation(actor, shopId, requestKey, body);
  }
}
