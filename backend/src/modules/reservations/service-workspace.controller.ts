import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Actor } from './reservation-validation';
import { ServiceWorkspaceCommandDto } from './service-workspace.dto';
import { ServiceWorkspaceService } from './service-workspace.service';
@Controller('reservation-admin/shops/:shopId/service-workspace-actions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT', 'STAFF')
export class ServiceWorkspaceController {
  constructor(private readonly service: ServiceWorkspaceService) {}
  @Get('snapshot') @Header('Cache-Control', 'no-store')
  snapshot(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).some(key => key !== 'serviceId') || query.serviceId !== undefined && typeof query.serviceId !== 'string') throw new BadRequestException('无效服务读取参数');
    return this.service.snapshot(shopId, actor, query.serviceId as string | undefined);
  }
  @Post() @HttpCode(200) @Header('Cache-Control', 'no-store')
  execute(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Body() body: ServiceWorkspaceCommandDto) { return this.service.execute(shopId, actor, body); }
  @Get(':key') @Header('Cache-Control', 'no-store')
  receipt(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Param('key') key: string) { return this.service.receipt(shopId, actor, key); }
  @Post(':key/reconcile') @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Param('shopId') shopId: string, @GetUser() actor: Actor, @Param('key') key: string, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new BadRequestException('核对操作不接受业务变更');
    return this.service.reconcile(shopId, actor, key);
  }
}
