import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StudioService } from './studio.service';
@Controller('studio')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class StudioController {
  constructor(private readonly studio: StudioService) {}
  @Get('summary') summary(@Req() req: any) { return this.studio.summary(req.user); }
  @Get(':resource') list(@Param('resource') resource: string, @Query() query: Record<string, string>, @Req() req: any) { return this.studio.list(resource, query, req.user); }
  @Post(':resource') create(@Param('resource') resource: string, @Body() body: Record<string, unknown>, @Req() req: any) { return this.studio.save(resource, undefined, body, req.user); }
  @Patch(':resource/:id') update(@Param('resource') resource: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: any) { return this.studio.save(resource, id, body, req.user); }
  @Delete(':resource/:id') remove(@Param('resource') resource: string, @Param('id') id: string, @Req() req: any) { return this.studio.remove(resource, id, req.user); }
}
