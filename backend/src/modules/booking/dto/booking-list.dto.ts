import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { BOOKING_LIST_STATUSES, BOOKING_LIST_VIEWS, BOOKING_PAYMENT_MODES, BOOKING_PAYMENT_STATUSES } from '../booking-list.query';

export class BookingListQueryDto {
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/) shopId?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,6}$/) page?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,2}$/) pageSize?: string;
  @IsOptional() @IsIn(BOOKING_LIST_STATUSES) status?: string;
  @IsOptional() @IsIn(BOOKING_LIST_VIEWS) view?: string;
  @IsOptional() @IsIn(BOOKING_PAYMENT_STATUSES) paymentStatus?: string;
  @IsOptional() @IsIn(BOOKING_PAYMENT_MODES) paymentMode?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{3}-\d{2}-\d{2}$/) startDate?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d{3}-\d{2}-\d{2}$/) endDate?: string;
}
