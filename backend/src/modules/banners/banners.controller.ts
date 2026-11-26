/**
 * MJAPP — Home Banner Public Controller
 * GET /banners — active banners for home carousel (authenticated)
 * POST /banners/:id/click — click tracking (authenticated)
 */

import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BannersService } from './banners.service';

@ApiTags('Banners')
@ApiBearerAuth()
@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Get()
  @ApiOperation({ summary: 'Get active home banners (sorted by sortOrder)' })
  async getActive() {
    return this.bannersService.getActiveBanners();
  }

  @Post(':id/click')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Record a banner click for analytics' })
  async recordClick(@Param('id') id: string) {
    return this.bannersService.recordClick(id);
  }
}
