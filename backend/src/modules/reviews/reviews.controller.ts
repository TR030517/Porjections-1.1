/**
 * MJAPP — Reviews Controller
 * Endpoints: CRUD reviews, list shop reviews (public), list my reviews (auth)
 */

import { Controller, Post, Get, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto, UpdateReviewDto, ReviewListQueryDto } from './dto/reviews.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a review (must own a completed booking)' })
  async create(@GetUser('id') userId: string, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(userId, dto);
  }

  @Get('my')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List my reviews' })
  async listMyReviews(@GetUser('id') userId: string) {
    return this.reviewsService.listMyReviews(userId);
  }

  @Get('shop/:shopId')
  @ApiOperation({ summary: 'List public reviews for a shop (no auth required)' })
  async listByShop(
    @Param('shopId') shopId: string,
    @Query() query: ReviewListQueryDto,
  ) {
    return this.reviewsService.listByShop(shopId, query.page ?? 1, query.limit ?? 10);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update own review' })
  async update(
    @GetUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviewsService.update(userId, id, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete own review' })
  async delete(@GetUser('id') userId: string, @Param('id') id: string) {
    return this.reviewsService.delete(userId, id);
  }
}
