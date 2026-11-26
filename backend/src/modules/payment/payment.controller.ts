import { Controller, Post, Get, Body, UseGuards, Req, Headers, RawBodyRequest, Param, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { IsString } from 'class-validator';
import { PaymentService } from './payment.service';
import { CreatePaymentIntentDto, ConfirmPaymentIntentDto } from './dto/payment.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
class QuoteDto { @IsString() bookingId: string; }
@Controller('payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}
  @Get('config') config() { return this.payments.config(); }
  @Post('quote') @UseGuards(AuthGuard('jwt'), RolesGuard) @Roles('CUSTOMER')
  quote(@Body() dto: QuoteDto, @GetUser('id') user: string) { return this.payments.quote(dto.bookingId, user); }
  @Post('create-intent') @UseGuards(AuthGuard('jwt'), RolesGuard) @Roles('CUSTOMER')
  create(@Body() dto: CreatePaymentIntentDto, @GetUser('id') userId: string) { return this.payments.createPaymentIntent({ ...dto, userId }); }
  @Post('confirm') @UseGuards(AuthGuard('jwt'), RolesGuard) @Roles('CUSTOMER')
  confirm(@Body() dto: ConfirmPaymentIntentDto, @GetUser('id') userId: string) { return this.payments.confirmPaymentIntent({ ...dto, userId }); }
  @Post('bookings/:id/reconcile') @UseGuards(AuthGuard('jwt'))
  reconcile(@Param('id') id: string, @Body() body: unknown, @GetUser('id') userId: string, @GetUser('role') role: string) {
    if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) throw new BadRequestException('Reconciliation accepts no payment identifiers or state');
    return this.payments.reconcileBooking(id, userId, role);
  }
  @Post('webhook')
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) { return this.payments.receiveWebhook(req.rawBody, signature); }
  @Post('square/webhook')
  squareWebhook(@Req() req: RawBodyRequest<Request>, @Headers('x-square-hmacsha256-signature') signature?: string) { return this.payments.receiveSquareWebhook(req.rawBody, signature); }
}
