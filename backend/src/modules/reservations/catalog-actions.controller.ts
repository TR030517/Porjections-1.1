import { Body, Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Actor } from './reservation-validation';
import { CatalogMutationDto } from './catalog-actions.dto';
import { CatalogActionsService } from './catalog-actions.service';

@Controller('reservation-admin/shops/:shopId/catalog-actions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT')
export class CatalogActionsController {
  constructor(private readonly service: CatalogActionsService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  execute(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: CatalogMutationDto) {
    return this.service.execute(shopId, actor, body);
  }
  @Get(':idempotencyKey')
  @Header('Cache-Control', 'no-store')
  receipt(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Param('idempotencyKey') key: string) {
    return this.service.receipt(shopId, actor, key);
  }
}
