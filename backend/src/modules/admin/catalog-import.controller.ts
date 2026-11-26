import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CatalogImportService } from './catalog-import.service';
import type { CatalogActor } from './catalog-import.contract';

export class CatalogImportPreviewDto {
  @IsString() @Matches(/^[1-9]\d{0,18}$/) shopId!: string;
  @IsString() @MaxLength(60 * 1024) text!: string;
}
export class CatalogImportApplyDto extends CatalogImportPreviewDto {
  @IsString() @MaxLength(4096) previewToken!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,100}$/) requestKey!: string;
}
export class CatalogImportResolveDto {
  @IsString() @Matches(/^[1-9]\d{0,18}$/) shopId!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,100}$/) requestKey!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) packageDigest!: string;
}

@Controller('admin/catalog-import')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class CatalogImportController {
  constructor(private readonly service: CatalogImportService) {}
  @Post('preview') @HttpCode(200)
  preview(@GetUser() actor: CatalogActor, @Body() body: CatalogImportPreviewDto, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return this.service.preview(actor, body.shopId, body.text);
  }
  @Post('apply') @HttpCode(200)
  apply(@GetUser() actor: CatalogActor, @Body() body: CatalogImportApplyDto, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return this.service.apply(actor, body.shopId, body.text, body.previewToken, body.requestKey);
  }
  @Get('result/:requestKey') @HttpCode(200)
  result(@GetUser() actor: CatalogActor, @Param('requestKey') key: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return this.service.result(actor, key);
  }
  @Post('resolve') @HttpCode(200)
  resolve(@GetUser() actor: CatalogActor, @Body() body: CatalogImportResolveDto, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store'); return this.service.resolve(actor, body.shopId, body.requestKey, body.packageDigest);
  }
}
