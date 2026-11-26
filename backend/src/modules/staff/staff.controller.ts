import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { ShopActor } from '../../common/shop-access';
import { CreateStaffDto, GrantStaffDto, StaffListDto, StaffPermissionsDto } from './staff.dto';
import { StaffService } from './staff.service';

@Controller('merchant/shops/:shopId/staff')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT')
export class StaffController {
  constructor(private readonly service: StaffService) {}
  @Get() @Header('Cache-Control', 'no-store') list(@Param('shopId') shopId: string, @GetUser() actor: ShopActor, @Query() query: StaffListDto) { return this.service.list(shopId, actor, query); }
  @Post() create(@Param('shopId') shopId: string, @GetUser() actor: ShopActor, @Body() body: CreateStaffDto) { return this.service.create(shopId, actor, body); }
  @Post('grants') grant(@Param('shopId') shopId: string, @GetUser() actor: ShopActor, @Body() body: GrantStaffDto) { return this.service.grant(shopId, actor, body); }
  @Patch(':userId') update(@Param('shopId') shopId: string, @Param('userId') userId: string, @GetUser() actor: ShopActor, @Body() body: StaffPermissionsDto) { return this.service.update(shopId, userId, actor, body); }
  @Delete(':userId') revoke(@Param('shopId') shopId: string, @Param('userId') userId: string, @GetUser() actor: ShopActor) { return this.service.revoke(shopId, userId, actor); }
}
