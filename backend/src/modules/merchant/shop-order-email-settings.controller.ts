import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ShopOrderEmailSettingsService } from './shop-order-email-settings.service';
import { ShopOrderEmailRevisionDto, ShopOrderEmailVerificationRequestDto, ShopOrderEmailVerifyDto } from './shop-order-email-settings.dto';

@ApiTags('Merchant booking notification email')
@ApiBearerAuth()
@Controller('merchant/shops/:shopId/order-email-settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT')
export class ShopOrderEmailSettingsController {
  constructor(private readonly settings: ShopOrderEmailSettingsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  get(@GetUser('id') id: string, @GetUser('role') role: string, @Param('shopId') shopId: string) {
    return this.settings.get({ id, role }, shopId);
  }
  @Post('verification')
  @Header('Cache-Control', 'no-store')
  request(@GetUser('id') id: string, @GetUser('role') role: string, @Param('shopId') shopId: string, @Body() input: ShopOrderEmailVerificationRequestDto) {
    return this.settings.requestVerification({ id, role }, shopId, input);
  }
  @Post('verify')
  @Header('Cache-Control', 'no-store')
  verify(@GetUser('id') id: string, @GetUser('role') role: string, @Param('shopId') shopId: string, @Body() input: ShopOrderEmailVerifyDto) {
    return this.settings.verify({ id, role }, shopId, input);
  }
  @Post('disable')
  @Header('Cache-Control', 'no-store')
  disable(@GetUser('id') id: string, @GetUser('role') role: string, @Param('shopId') shopId: string, @Body() input: ShopOrderEmailRevisionDto) {
    return this.settings.disable({ id, role }, shopId, input);
  }
}
