import { Body, Controller, Header, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { assertTrustedOrigin } from './auth.controller';
import { ChangeManagementPasswordDto, RecoverManagementPasswordDto } from './dto/management-password.dto';
import { ManagementPasswordActor, ManagementPasswordService } from './management-password.service';

@Controller('auth')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ManagementPasswordController {
  constructor(private readonly passwords: ManagementPasswordService) {}

  @Post('password/change') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @Roles('ADMIN', 'MERCHANT', 'STAFF') @Throttle({ default: { limit: 5, ttl: 60000 } })
  async change(@GetUser() actor: ManagementPasswordActor, @Body() body: ChangeManagementPasswordDto, @Req() req: Request) {
    assertTrustedOrigin(req);
    return this.passwords.change(actor, body);
  }

  @Post('accounts/:id/password/recover') @HttpCode(200) @Header('Cache-Control', 'no-store')
  @Roles('ADMIN') @Throttle({ default: { limit: 5, ttl: 60000 } })
  recover(@GetUser() actor: ManagementPasswordActor, @Param('id') id: string, @Body() body: RecoverManagementPasswordDto, @Req() req: Request) {
    assertTrustedOrigin(req);
    return this.passwords.recover(actor, id, body);
  }
}
