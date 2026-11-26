/**
 * MJAPP — Payment DTOs
 * Validation for PaymentIntent creation and confirmation
 */

import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePaymentIntentDto {
  @ApiPropertyOptional({ example: 5000, description: 'Amount in cents. Optional — server computes payable amount from booking (price - discount + fee).' })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(99999999)
  amountCents?: number;

  @ApiPropertyOptional({ example: 'usd', description: 'Currency code (default: usd)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ example: '1', description: 'Booking ID to associate with this payment' })
  @IsString()
  bookingId: string;

  @ApiPropertyOptional({ example: '1', description: 'Shop ID for revenue attribution (optional, derived from booking)' })
  @IsOptional()
  @IsString()
  shopId?: string;
}

export class ConfirmPaymentIntentDto {
  @ApiProperty({ example: 'pi_mock_abc123', description: 'PaymentIntent ID to confirm' })
  @IsString()
  paymentIntentId: string;
}
