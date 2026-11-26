/**
 * MJAPP — ShopReview Controller
 *
 * Admin-only endpoints for reviewing shop registrations.
 * All routes are protected by AuthGuard('jwt') + RolesGuard with @Roles('ADMIN').
 */

import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ShopReviewService } from './shop-review.service';
import { ShopReviewQueryDto, ReviewShopDto } from './dto/shop-review.dto';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Admin — Shop Review')
@Controller('admin/shops')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class ShopReviewController {
  constructor(private readonly shopReviewService: ShopReviewService) {}

  @Get()
  @ApiOperation({
    summary: 'List shops for admin review',
    description: 'Paginated shop list filtered by review status, with owner and certificate info.',
  })
  async findAll(@Query() query: ShopReviewQueryDto) {
    return this.shopReviewService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get shop detail for review',
    description: 'Full shop detail including services, therapists, images, certificates, recent bookings, and audit logs.',
  })
  async findOne(@Param('id') id: string) {
    return this.shopReviewService.findOne(id);
  }

  @Patch(':id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Review a shop',
    description: 'Approve, reject, or request more info for a shop registration. Records the action in AuditLog.',
  })
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewShopDto,
    @GetUser('id') operatorId: string,
  ) {
    return this.shopReviewService.review(id, dto, operatorId);
  }
}
