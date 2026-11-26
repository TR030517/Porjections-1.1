import { Body, Controller, Get, Header, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AccountCopyService } from './account-copy.service';
export class CopyPreviewDto {
  @IsString() @Matches(/^[1-9]\d{0,18}$/) sourceShopId!: string;
  @IsString() @Matches(/^[1-9]\d{0,18}$/) targetShopId!: string;
  @IsIn(['HOURS', 'CATALOG', 'PRICE_MENU', 'ADD_ONS']) kind!: 'HOURS' | 'CATALOG' | 'PRICE_MENU' | 'ADD_ONS';
}
export class CopyApplyDto extends CopyPreviewDto {
  @IsString() @MaxLength(2048) previewHash!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,100}$/) idempotencyKey!: string;
}
export class CopyHistoryQueryDto {
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,3}$/) page?: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d?$/) limit?: string;
}
@Controller('account-access/copy')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT')
export class AccountCopyController {
  constructor(private readonly copies: AccountCopyService) {}
  @Post('preview') @Header('Cache-Control', 'no-store')
  preview(@Req() req: any, @Body() body: CopyPreviewDto) { return this.copies.preview(req.user, body); }
  @Post('apply') @Header('Cache-Control', 'no-store')
  apply(@Req() req: any, @Body() body: CopyApplyDto) { return this.copies.apply(req.user, body); }
  @Post('resolve') @Header('Cache-Control', 'no-store')
  resolve(@Req() req: any, @Body() body: CopyApplyDto) { return this.copies.resolve(req.user, body); }
  @Get('history') @Header('Cache-Control', 'no-store')
  history(@Req() req: any, @Query() query: CopyHistoryQueryDto) { return this.copies.history(req.user, query); }
}
