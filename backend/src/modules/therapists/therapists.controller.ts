/**
 * MJAPP — Therapists Controller
 * Independent CRUD for shop therapists
 */

import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TherapistsService } from './therapists.service';

@ApiTags('Therapists')
@Controller('therapists')
export class TherapistsController {
  constructor(private readonly therapistsService: TherapistsService) {}

  @Get()
  @ApiOperation({ summary: 'List all therapists with optional filters' })
  @ApiQuery({ name: 'shopId', required: false, type: String })
  async listTherapists(@Query('shopId') shopId?: string) {
    return this.therapistsService.listTherapists({ shopId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get therapist detail' })
  async getTherapist(@Param('id') id: string) {
    return this.therapistsService.getTherapist(id);
  }
}
