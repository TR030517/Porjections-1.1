/**
 * MJAPP — Root Controller
 */

import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  healthCheck() {
    return this.appService.getHealth();
  }

  @Get()
  @ApiOperation({ summary: 'Root endpoint' })
  root() {
    return this.appService.getRoot();
  }
}
