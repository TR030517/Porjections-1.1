/**
 * MJAPP — Shops Controller
 * Endpoints: list, nearby, detail, slots, search
 */

import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ShopsService } from './shops.service';
import { ShopListQueryDto, NearbyQueryDto, ResolveShopQueryDto } from './dto/shop.dto';

@ApiTags('Shops')
@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get()
  @ApiOperation({ summary: 'List shops with filters, pagination, and optional GPS sorting' })
  async listShops(@Query() query: ShopListQueryDto) {
    return this.shopsService.listShops({
      lat: query.lat,
      lng: query.lng,
      radius: query.radius,
      category: query.category,
      keyword: query.keyword,
      city: query.city,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('nearby')
  @ApiOperation({ summary: 'Find nearby shops by GPS coordinates' })
  async findNearby(@Query() query: NearbyQueryDto) {
    return this.shopsService.findNearby({
      lat: query.lat,
      lng: query.lng,
      radius: query.radius,
      limit: query.limit,
    });
  }

  @Get('resolve')
  @ApiOperation({ summary: 'Resolve a stable short name or explicitly mapped Massajoy1 legacy shop ID' })
  resolve(@Query() query: ResolveShopQueryDto) { return this.shopsService.resolve(query); }

  @Get(':id/slots')
  @ApiOperation({ summary: 'Get available time slots for a shop on a given date' })
  @ApiQuery({ name: 'date', required: true, type: String, example: '2026-06-07' })
  async getSlots(@Param('id') id: string, @Query('date') date: string) {
    return this.shopsService.getAvailableSlots(id, date);
  }

  @Get(':id/services')
  @ApiOperation({ summary: 'Get services for a specific shop' })
  async getShopServices(@Param('id') id: string) {
    return this.shopsService.getShopServices(id);
  }

  @Get(':id/therapists')
  @ApiOperation({ summary: 'Get therapists for a specific shop' })
  async getShopTherapists(@Param('id') id: string) {
    return this.shopsService.getShopTherapists(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get shop detail with services, therapists, and images' })
  async getShop(@Param('id') id: string) {
    return this.shopsService.getShop(id);
  }
}
