import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsDefined, IsObject, IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { PublicIntakeService, IntakeActor } from './public-intake.service';
export class PublicIntakePreviewDto { @IsDefined() @IsObject() package!: Record<string,unknown>; }
export class PublicIntakeApplyDto extends PublicIntakePreviewDto {
  @IsString() @MaxLength(8192) previewToken!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,100}$/) requestKey!: string;
}
export class PublicIntakeResolveDto {
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,100}$/) requestKey!:string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) packageDigest!:string;
}
@Controller('admin/public-intake')
@UseGuards(AuthGuard('jwt'),RolesGuard)
@Roles('ADMIN')
export class PublicIntakeController {
  constructor(private readonly service:PublicIntakeService){}
  @Post('preview') @HttpCode(200)
  preview(@GetUser() actor:IntakeActor,@Body() body:PublicIntakePreviewDto,@Res({passthrough:true}) response:Response){response.setHeader('Cache-Control','no-store');return this.service.preview(actor,body.package);}
  @Post('apply') @HttpCode(200)
  apply(@GetUser() actor:IntakeActor,@Body() body:PublicIntakeApplyDto,@Res({passthrough:true}) response:Response){response.setHeader('Cache-Control','no-store');return this.service.apply(actor,body.package,body.previewToken,body.requestKey);}
  @Post('resolve') @HttpCode(200)
  resolve(@GetUser() actor:IntakeActor,@Body() body:PublicIntakeResolveDto,@Res({passthrough:true}) response:Response){response.setHeader('Cache-Control','no-store');return this.service.resolve(actor,body.requestKey,body.packageDigest);}
  @Get('result/:requestKey')
  result(@GetUser() actor:IntakeActor,@Param('requestKey') key:string,@Res({passthrough:true}) response:Response){response.setHeader('Cache-Control','no-store');return this.service.result(actor,key);}
}
