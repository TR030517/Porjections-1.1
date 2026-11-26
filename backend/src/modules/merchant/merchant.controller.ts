/**
 * MJAPP — Merchant Controller
 * All merchant-specific endpoints grouped under /merchant prefix
 */

import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Res,
  UseGuards, Headers,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiProduces } from '@nestjs/swagger';
import { Response } from 'express';
import { MerchantService } from './merchant.service';
import {
  ApplyMerchantDto, UpdateShopDto, SetBusinessHoursDto,
  AddShopImageDto, AddCertificateDto,
  CreateShopServiceDto, UpdateShopServiceDto,
  DashboardQueryDto,
  CreateStripeOnboardingDto,
  PayoutRequestDto,
  TransactionQueryDto,
  TaxReportQueryDto,
  CreateTherapistDto, UpdateTherapistDto,
  MerchantShopQueryDto,
} from './dto/merchant.dto';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { BookingListQueryDto } from '../booking/dto/booking-list.dto';

@ApiTags('Merchant')
@Controller('merchant')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class MerchantController {
  constructor(private readonly merchantService: MerchantService) {}

  /* ════════════════════════════════════════════
     P2-T01: Onboarding
     ════════════════════════════════════════════ */

  @Post('apply')
  @ApiOperation({ summary: 'Apply as a merchant (create shop + profile)' })
  async apply(@GetUser('id') userId: string, @Body() dto: ApplyMerchantDto) {
    return this.merchantService.apply({ ...dto, userId });
  }

  @Get('application-status')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Get current merchant application status' })
  async getApplicationStatus(@GetUser('role') actorRole: string, @GetUser('id') userId: string, @Query() query: MerchantShopQueryDto) {
    return this.merchantService.getApplicationStatus(userId, query.shopId, actorRole);
  }

  /* ════════════════════════════════════════════
     P2-T02: Shop Management (Merchant role)
     ════════════════════════════════════════════ */

  @Get('shops')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Get my shops (merchant only)' })
  async getMyShops(@GetUser('role') actorRole: string, @GetUser('id') userId: string) {
    return this.merchantService.getMyShops(userId, actorRole);
  }

  @Patch('shops/:shopId')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Update shop info' })
  async updateShop(
    @GetUser('role') actorRole: string, @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Body() dto: UpdateShopDto,
  ) {
    return this.merchantService.updateShop(userId, shopId, dto, actorRole);
  }

  @Post('shops/:shopId/business-hours')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Set shop business hours' })
  async setBusinessHours(
    @GetUser('role') actorRole: string, @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Body() dto: SetBusinessHoursDto,
  ) {
    return this.merchantService.setBusinessHours(userId, shopId, dto.hours, actorRole);
  }

  @Post('shops/:shopId/images')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Add shop image' })
  async addImage(
    @GetUser('role') actorRole: string, @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Body() dto: AddShopImageDto,
  ) {
    return this.merchantService.addShopImage(userId, shopId, dto, actorRole);
  }

  @Delete('images/:imageId')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Delete shop image' })
  async deleteImage(@GetUser('role') actorRole: string, @GetUser('id') userId: string, @Param('imageId') imageId: string) {
    return this.merchantService.deleteShopImage(userId, imageId, actorRole);
  }

  @Post('shops/:shopId/certificates')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Add certificate to shop' })
  async addCertificate(
    @GetUser('role') actorRole: string, @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Body() dto: AddCertificateDto,
  ) {
    return this.merchantService.addCertificate(userId, shopId, dto, actorRole);
  }

  /* ════════════════════════════════════════════
     P2-T02: Service Management
     ════════════════════════════════════════════ */

  @Get('shops/:shopId/services')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'List shop services (merchant)' })
  async getShopServices(@GetUser('role') actorRole: string, @GetUser('id') userId: string, @Param('shopId') shopId: string) {
    return this.merchantService.getShopServices(userId, shopId, actorRole);
  }

  @Post('shops/:shopId/services')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Create a shop service' })
  async createService(
    @GetUser('role') actorRole: string, @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Body() dto: CreateShopServiceDto,
  ) {
    return this.merchantService.createShopService(userId, shopId, dto, actorRole);
  }

  @Patch('services/:serviceId')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Update a shop service' })
  async updateService(
    @GetUser('role') actorRole: string, @GetUser('id') userId: string,
    @Param('serviceId') serviceId: string,
    @Body() dto: UpdateShopServiceDto,
  ) {
    return this.merchantService.updateShopService(userId, serviceId, dto, actorRole);
  }

  @Delete('services/:serviceId')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Delete a shop service' })
  async deleteService(@GetUser('role') actorRole: string, @GetUser('id') userId: string, @Param('serviceId') serviceId: string) {
    return this.merchantService.deleteShopService(userId, serviceId, actorRole);
  }

  /* ════════════════════════════════════════════
     P2-T03: Therapist Management
     ════════════════════════════════════════════ */

  @Get('shops/:shopId/therapists')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'List shop therapists (merchant)' })
  async getTherapists(@GetUser('role') actorRole: string, @GetUser('id') userId: string, @Param('shopId') shopId: string) {
    return this.merchantService.getMyTherapists(userId, shopId, actorRole);
  }

  @Post('shops/:shopId/therapists')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Create a therapist' })
  async createTherapist(
    @GetUser('role') actorRole: string, @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Body() body: CreateTherapistDto,
  ) {
    return this.merchantService.createTherapist(userId, shopId, body, actorRole);
  }

  @Patch('therapists/:therapistId')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Update a therapist' })
  async updateTherapist(
    @GetUser('role') actorRole: string, @GetUser('id') userId: string,
    @Param('therapistId') therapistId: string,
    @Body() body: UpdateTherapistDto,
  ) {
    return this.merchantService.updateTherapist(userId, therapistId, body, actorRole);
  }

  @Delete('therapists/:therapistId')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Delete (deactivate) a therapist' })
  async deleteTherapist(@GetUser('role') actorRole: string, @GetUser('id') userId: string, @Param('therapistId') therapistId: string) {
    return this.merchantService.deleteTherapist(userId, therapistId, actorRole);
  }

  /* ════════════════════════════════════════════
     P2-T03: Booking Management
     ════════════════════════════════════════════ */

  @Get('shops/:shopId/bookings')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'STAFF', 'ADMIN')
  @ApiOperation({ summary: 'List shop bookings' })
  @ApiQuery({ name: 'status', required: false })
  async getBookings(@GetUser('role') actorRole: string, 
    @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Query() query: BookingListQueryDto,
  ) {
    return this.merchantService.getShopBookings(userId, shopId, query, actorRole);
  }

  @Post('bookings/:bookingId/confirm')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Confirm a pending booking' })
  async confirmBooking(@GetUser('role') actorRole: string, @GetUser('id') userId: string, @Param('bookingId') bookingId: string, @Headers('idempotency-key') key?: string) {
    return key === undefined ? this.merchantService.confirmBooking(userId, bookingId, actorRole) : this.merchantService.confirmBooking(userId, bookingId, actorRole, key);
  }

  @Post('bookings/:bookingId/complete')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Mark booking as completed' })
  async completeBooking(@GetUser('role') actorRole: string, @GetUser('id') userId: string, @Param('bookingId') bookingId: string, @Headers('idempotency-key') key?: string) {
    return key === undefined ? this.merchantService.completeBooking(userId, bookingId, actorRole) : this.merchantService.completeBooking(userId, bookingId, actorRole, key);
  }

  /* ════════════════════════════════════════════
     P2-T05: Dashboard & Stats
     ════════════════════════════════════════════ */

  @Get('shops/:shopId/dashboard')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Get shop dashboard statistics' })
  async getDashboard(@GetUser('role') actorRole: string, 
    @GetUser('id') userId: string,
    @Param('shopId') shopId: string,
    @Query() query: DashboardQueryDto,
  ) {
    return this.merchantService.getDashboard(userId, shopId, query.startDate, query.endDate, actorRole);
  }

  /* ════════════════════════════════════════════
     P2-T04: Stripe Connect Onboarding
     ════════════════════════════════════════════ */

  @Post('stripe/onboarding')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Create Stripe Connect onboarding link' })
  async createStripeOnboarding(
    @GetUser('id') userId: string,
    @Body() dto: CreateStripeOnboardingDto,
  ) {
    return this.merchantService.createStripeOnboardingUrl(userId, dto.shopId);
  }

  @Get('stripe/onboarding-status')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Get Stripe Connect onboarding status' })
  async getStripeOnboardingStatus(@GetUser('id') userId: string) {
    return this.merchantService.getStripeOnboardingStatus(userId);
  }

  /* ════════════════════════════════════════════
     P2-T04-US-004: Payout & Transactions
     ════════════════════════════════════════════ */

  @Post('payout')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'ADMIN')
  @ApiOperation({ summary: 'Withdraw funds (payout to bank account)' })
  async requestPayout(
    @GetUser('id') userId: string,
    @Body() dto: PayoutRequestDto,
  ) {
    return this.merchantService.requestPayout(userId, dto.amountCents);
  }

  @Get('transactions')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Get paginated transaction list' })
  async getTransactions(@GetUser('role') actorRole: string, 
    @GetUser('id') userId: string,
    @Query() query: TransactionQueryDto,
  ) {
    return this.merchantService.getTransactions(userId, {
      shopId: query.shopId,
      page: query.page || 1,
      pageSize: query.pageSize || 10,
      startDate: query.startDate,
      endDate: query.endDate,
    }, actorRole);
  }

  /* ════════════════════════════════════════════
     P2-T04-US-006: Tax Report
     ════════════════════════════════════════════ */

  @Get('tax-report')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Get annual shop ledger totals (not a tax filing)' })
  async getTaxReport(@GetUser('role') actorRole: string, 
    @GetUser('id') userId: string,
    @Query() query: TaxReportQueryDto,
  ) {
    return this.merchantService.getTaxReport(userId, query.year, query.shopId, actorRole);
  }

  @Get('tax-report/export')
  @UseGuards(RolesGuard)
  @Roles('MERCHANT', 'STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Export annual shop ledger CSV (not a tax filing)' })
  @ApiProduces('text/csv')
  async exportTaxReportCsv(@GetUser('role') actorRole: string, 
    @GetUser('id') userId: string,
    @Query() query: TaxReportQueryDto,
    @Res() res: Response,
  ) {
    const summary = await this.merchantService.getTaxReport(userId, query.year, query.shopId, actorRole);
    const csv = await this.merchantService.exportTaxReportCsv(userId, summary.year, summary.shopId, actorRole);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ledger-${summary.shopId}-${summary.year}.csv"`);
    res.send(csv);
  }
}
