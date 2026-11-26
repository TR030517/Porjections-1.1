/**
 * MJAPP — Services Controller
 * Independent CRUD for shop services (massage types, duration, pricing)
 */

import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ServicesService } from './services.service';

@ApiTags('Services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  @ApiOperation({ summary: 'List all services with optional filters' })
  @ApiQuery({ name: 'shopId', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  async listServices(
    @Query('shopId') shopId?: string,
    @Query('category') category?: string,
  ) {
    return this.servicesService.listServices({ shopId, category });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get service detail' })
  async getService(@Param('id') id: string) {
    return this.servicesService.getService(id);
  }
}
