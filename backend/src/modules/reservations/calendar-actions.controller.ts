import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Actor } from './reservation-validation';
import { CalendarActionDto } from './calendar-actions.dto';
import { CalendarActionsService } from './calendar-actions.service';

@Controller('reservation-admin/shops/:shopId/calendar-actions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT', 'STAFF')
export class CalendarActionsController {
  constructor(private readonly service: CalendarActionsService) {}
  @Post() @Header('Cache-Control', 'no-store')
  execute(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: CalendarActionDto) {
    return this.service.execute(shopId, actor, body);
  }
  @Get('options') @Header('Cache-Control', 'no-store')
  options(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Query() query: Record<string, unknown>) {
    return this.service.options(shopId, actor, query);
  }
  @Get('blocks/:blockId') @Header('Cache-Control', 'no-store')
  block(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Param('blockId') blockId: string) {
    return this.service.block(shopId, actor, blockId);
  }
  @Get('operations/:requestKey') @Header('Cache-Control', 'no-store')
  receipt(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Param('requestKey') requestKey: string) {
    return this.service.receipt(shopId, actor, requestKey);
  }
  @Post('operations/:requestKey/reconcile') @Header('Cache-Control', 'no-store')
  reconcile(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Param('requestKey') requestKey: string, @Body() body: unknown) {
    return this.service.reconcile(shopId, actor, requestKey, body);
  }
}
