import { Body, Controller, Header, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { assertTrustedOrigin } from './auth.controller';
import { CustomerPasswordActor, CustomerPasswordService } from './customer-password.service';
import { ChangeCustomerPasswordDto, CompleteCustomerPasswordRecoveryDto, RequestCustomerPasswordRecoveryDto } from './dto/customer-password.dto';

@Controller('auth/customer/password')
export class CustomerPasswordController {
  constructor(private readonly passwords: CustomerPasswordService) {}
  @Post('change') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(AuthGuard('jwt'), RolesGuard) @Roles('CUSTOMER') @Throttle({ default: { limit: 5, ttl: 60000 } })
  async change(@GetUser() actor: CustomerPasswordActor, @Body() body: ChangeCustomerPasswordDto, @Req() req: Request) {
    assertTrustedOrigin(req);
    // Do not mutate browser cookies: a late response for account A must not
    // erase a newer account B cookie. The transaction revokes A's sessions.
    return this.passwords.change(actor, body);
  }
  @Post('recovery/request') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 5, ttl: 60000 } })
  request(@Body() body: RequestCustomerPasswordRecoveryDto, @Req() req: Request) {
    assertTrustedOrigin(req);
    return this.passwords.requestRecovery(body.email);
  }
  @Post('recovery/complete') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 10, ttl: 60000 } })
  async recover(@Body() body: CompleteCustomerPasswordRecoveryDto, @Req() req: Request) {
    assertTrustedOrigin(req);
    return this.passwords.recover(body);
  }
}
