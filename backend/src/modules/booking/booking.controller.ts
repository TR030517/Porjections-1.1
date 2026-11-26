/**
 * MJAPP — Booking Controller
 * Endpoints: slots, create, get, list, cancel, status update
 * User identity extracted from JWT token (never from request body)
 */

import { Controller, Post, Get, Param, Body, Query, UseGuards, Patch, Delete, Headers, BadRequestException, HttpCode } from '@nestjs/common';
import { JwtAuthGuard, Public } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';
import { BookingService } from './booking.service';
import { CreateBookingDto, CancelBookingDto, SlotsQueryDto, RefundBookingDto, PartialRefundBookingDto, RescheduleBookingDto, PlanSlotsDto, CreatePlanDto, RescheduleSlotsDto, QuoteBookingDto, QuotePlanDto } from './dto/booking.dto';
import { BookingListQueryDto } from './dto/booking-list.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { SettlementService } from './settlement.service';
import { OfflineReceiptDto, ReverseReceiptDto } from './dto/settlement.dto';

@ApiTags('Bookings')
@Controller('bookings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BookingController {
  constructor(private readonly bookingService: BookingService, private readonly settlements: SettlementService) {}

  @Get('slots')
  @Public()
  @ApiOperation({ summary: 'Get available time slots for a therapist/service/date' })
  async getSlots(@Query() query: SlotsQueryDto) {
    return this.bookingService.getAvailableSlots({
      shopId: query.shopId,
      therapistId: query.therapistId,
      serviceId: query.serviceId,
      date: query.date,
      variantId: query.variantId,
      preferredTherapistIds: query.preferredTherapistIds,
    });
  }


  @Post()
  @UseGuards(RolesGuard)
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Create a booking (user ID from JWT)' })
  async createBooking(
    @Body() dto: CreateBookingDto,
    @GetUser('id') userId: string,
    @Headers('idempotency-key') key?: string,
  ) {
    if (key && dto.requestKey && key !== dto.requestKey) throw new BadRequestException('Body and header reservation request keys must match');
    return this.bookingService.createBooking({
      userId,
      contact: dto.contact,
      shopId: dto.shopId,
      therapistId: dto.therapistId,
      serviceId: dto.serviceId,
      date: dto.date,
      startTime: dto.startTime,
      durationMin: dto.durationMin,
      notes: dto.notes,
      couponId: dto.couponId,
      variantId: dto.variantId,
      preferredTherapistIds: dto.preferredTherapistIds,
      requestKey: dto.requestKey ?? key,
      paymentMode: dto.paymentMode,
      tipCents: dto.tipCents,
      addOnSelections: dto.addOnSelections, quoteHash: dto.quoteHash, quoteExpiresAt: dto.quoteExpiresAt,
    });
  }

  @Post('quote')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('CUSTOMER')
  quote(@Body() dto: QuoteBookingDto, @GetUser('id') userId: string) {
    return this.bookingService.quoteBooking({ ...dto, userId });
  }

  @Post('plan-quote')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('CUSTOMER')
  planQuote(@Body() dto: QuotePlanDto, @GetUser('id') userId: string) {
    return this.bookingService.quotePlan({ ...dto, userId });
  }

  @Get()
  @ApiOperation({ summary: 'List current user bookings (from JWT)' })
  async listMyBookings(@GetUser('id') userId: string, @Query() query: BookingListQueryDto) {
    return this.bookingService.listUserBookings(userId, query);
  }

  @Post('plan-slots')
  @Public()
  planSlots(@Body() dto: PlanSlotsDto) { return this.bookingService.getPlanSlots(dto); }
  @Post('plan')
  @UseGuards(RolesGuard)
  @Roles('CUSTOMER')
  createPlan(@Body() dto: CreatePlanDto, @GetUser('id') userId: string, @Headers('idempotency-key') key?: string) {
    if (key && key !== dto.requestKey) throw new BadRequestException('Body and header reservation request keys must match');
    return this.bookingService.createPlan({ ...dto, userId });
  }
  @Get(':id/reschedule-slots')
  rescheduleSlots(@Param('id') id: string, @GetUser('id') userId: string, @GetUser('role') role: string, @Query() query: RescheduleSlotsDto) {
    return this.bookingService.getRescheduleSlots(id, userId, role, query.date);
  }

  @Post(':id/reschedule')
  @ApiOperation({ summary: 'Atomically move a reservation without changing its quote' })
  reschedule(@Param('id') id: string, @GetUser('id') userId: string, @Body() dto: RescheduleBookingDto, @GetUser('role') role: string, @Headers('idempotency-key') key?: string) {
    return key === undefined ? this.bookingService.rescheduleBooking(id, userId, dto, role) : this.bookingService.rescheduleBooking(id, userId, dto, role, key);
  }

  @Post(':id/operations/:key/reconcile')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'MERCHANT', 'STAFF', 'CUSTOMER')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a booking command or durably fence it before allowing a replacement' })
  reconcileOperation(@Param('id') id: string, @Param('key') key: string, @GetUser('id') actor: string, @GetUser('role') role: string) {
    return this.bookingService.reconcileOperation(id, actor, role, key);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking detail (ownership check)' })
  async getBooking(
    @Param('id') id: string,
    @GetUser('id') userId: string,
    @GetUser('role') userRole: string,
  ) {
    return this.bookingService.getBooking(id, userId, userRole);
  }

  @Get(':id/settlements')
  settlementSummary(@Param('id') id: string, @GetUser('id') actor: string, @GetUser('role') role: string) {
    return this.settlements.get(id, actor, role);
  }
  @Post(':id/offline-receipts')
  receipt(@Param('id') id: string, @GetUser('id') actor: string, @GetUser('role') role: string, @Body() body: OfflineReceiptDto, @Headers('idempotency-key') key?: string) {
    return key === undefined ? this.settlements.recordReceipt(id, actor, role, body) : this.settlements.recordReceipt(id, actor, role, body, key);
  }
  @Post(':id/offline-receipts/:entryId/reverse')
  reverseReceipt(@Param('id') id: string, @Param('entryId') entryId: string, @GetUser('id') actor: string, @GetUser('role') role: string, @Body() body: ReverseReceiptDto, @Headers('idempotency-key') key?: string) {
    return key === undefined ? this.settlements.reverse(id, entryId, actor, role, body) : this.settlements.reverse(id, entryId, actor, role, body, key);
  }
  @Post(':id/offline-refunds')
  offlineRefund(@Param('id') id: string, @GetUser('id') actor: string, @GetUser('role') role: string, @Body() body: OfflineReceiptDto, @Headers('idempotency-key') key?: string) {
    return key === undefined ? this.settlements.recordRefund(id, actor, role, body) : this.settlements.recordRefund(id, actor, role, body, key);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update booking status (state machine)' })
  @ApiQuery({ name: 'status', required: true, type: String, example: 'CANCELLED' })
  @ApiBody({ type: CancelBookingDto, required: false })
  async updateStatus(
    @Param('id') id: string,
    @Query('status') status: string,
    @GetUser('id') userId: string,
    @GetUser('role') role: string,
    @Headers('idempotency-key') key?: string,
    @Body('cancelReason') cancelReason?: unknown,
  ) {
    if (cancelReason !== undefined) return this.bookingService.updateBookingStatus(id, userId, status, role, key, cancelReason);
    return key === undefined ? this.bookingService.updateBookingStatus(id, userId, status, role) : this.bookingService.updateBookingStatus(id, userId, status, role, key);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a booking (user ID from JWT)' })
  @ApiBody({ type: CancelBookingDto, required: false })
  async cancelBooking(
    @Param('id') id: string,
    @GetUser('id') userId: string,
    @GetUser('role') role: string,
    @Headers('idempotency-key') key?: string,
    @Body('cancelReason') cancelReason?: unknown,
  ) {
    if (cancelReason !== undefined) return this.bookingService.cancelBooking(id, userId, role, key, cancelReason);
    return key === undefined ? this.bookingService.cancelBooking(id, userId, role) : this.bookingService.cancelBooking(id, userId, role, key);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hide an owned terminal unpaid booking; retain financial records' })
  async deleteBooking(
    @Param('id') id: string,
    @GetUser('id') userId: string,
  ) {
    return this.bookingService.deleteBooking(id, userId);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Request full refund (booking owner or merchant)' })
  async requestRefund(
    @Param('id') id: string,
    @GetUser('id') userId: string,
    @Body() _dto: RefundBookingDto,
    @GetUser('role') role: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookingService.requestRefund(id, userId, role, key);
  }

  @Post(':id/refund-partial')
  @ApiOperation({ summary: 'Request partial refund (booking owner or merchant)' })
  async requestPartialRefund(
    @Param('id') id: string,
    @GetUser('id') userId: string,
    @Body() dto: PartialRefundBookingDto,
    @GetUser('role') role: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bookingService.requestPartialRefund(id, userId, dto.amountCents, role, key);
  }
}
