import { Body, Controller, Delete, Get, Header, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { AccountReasonDto, BindShopLoginDto, CreateAndBindShopAccountDto, GrantShopAccountDto, ResetShopAccountPasswordDto, SaveShopCredentialsDto } from './account-access.dto';
import { AccountAccessService } from './account-access.service';
import { AccountActor } from './account-access.validation';

@Controller('account-access/admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class AccountAccessController {
  constructor(private readonly service: AccountAccessService) {}
  @Get('overview') @Header('Cache-Control', 'no-store')
  overview(@GetUser() actor: AccountActor) { return this.service.overview(actor); }
  @Post('bind') @Header('Cache-Control', 'no-store')
  bind(@GetUser() actor: AccountActor, @Body() body: BindShopLoginDto) { return this.service.bind(actor, body); }
  @Post('create-and-bind') @Header('Cache-Control', 'no-store')
  createAndBind(@GetUser() actor: AccountActor, @Body() body: CreateAndBindShopAccountDto) { return this.service.createAndBind(actor, body); }
  @Post('grants') @Header('Cache-Control', 'no-store')
  grant(@GetUser() actor: AccountActor, @Body() body: GrantShopAccountDto) { return this.service.grant(actor, body); }
  @Delete('grants/:id') @Header('Cache-Control', 'no-store')
  revoke(@GetUser() actor: AccountActor, @Param('id') id: string, @Body() body: AccountReasonDto) { return this.service.revoke(actor, id, body); }
  @Patch('accounts/:id/password') @Header('Cache-Control', 'no-store')
  password(@GetUser() actor: AccountActor, @Param('id') id: string, @Body() body: ResetShopAccountPasswordDto) { return this.service.resetPassword(actor, id, body); }
  @Get('shops/:id/credentials') @Header('Cache-Control', 'no-store')
  credentials(@GetUser() actor: AccountActor, @Param('id') id: string) { return this.service.credentials(actor, id); }
  @Patch('shops/:id/credentials') @Header('Cache-Control', 'no-store')
  saveCredentials(@GetUser() actor: AccountActor, @Param('id') id: string, @Body() body: SaveShopCredentialsDto) { return this.service.saveCredentials(actor, id, body); }
}
