import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ShopReadinessService } from './shop-readiness.service';
import type { ReadinessActor } from './shop-readiness.contract';

@Controller('admin/shop-readiness')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class ShopReadinessController {
  constructor(private readonly service: ShopReadinessService) {}
  @Get(':shopId') @Header('Cache-Control', 'no-store')
  get(@GetUser() actor: ReadinessActor, @Param('shopId') shopId: string) { return this.service.get(actor, shopId); }
}
