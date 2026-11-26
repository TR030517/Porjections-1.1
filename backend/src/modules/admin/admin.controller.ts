/**
 * MJAPP — Admin Controller
 * Admin-specific endpoints grouped under /admin prefix.
 * Uses AuthGuard('jwt') + RolesGuard with @Roles('ADMIN') for protected routes.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminLoginDto, AdminRefreshTokenDto } from './dto/admin.dto';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /* ════════════════════════════════════════════
     P3-T01-US-001: Admin Authentication
     ════════════════════════════════════════════ */

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP to admin phone (must be ADMIN role)' })
  async sendOtp(@Body() dto: { phone: string }) {
    return this.adminService.sendOtp(dto.phone);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin login (phone + OTP, must have ADMIN role)' })
  async login(@Body() dto: AdminLoginDto) {
    return this.adminService.login(dto.phone, dto.code);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh admin access token' })
  async refresh(@Body() dto: AdminRefreshTokenDto) {
    return this.adminService.refreshToken(dto.refreshToken);
  }

  @Get('profile')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current admin profile' })
  async getProfile(@GetUser('id') userId: string) {
    return this.adminService.getProfile(userId);
  }

  @Get('list')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all admin accounts' })
  async listAdmins() {
    return this.adminService.listAdmins();
  }
}
