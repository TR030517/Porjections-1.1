import { Controller, Get, Post, Delete, Param, Res, Req, UseGuards, UseInterceptors, UploadedFile, Query, Body, Header } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UploadService } from './upload.service';
import { EmptyMediaDto,MediaUploadDto } from './media.dto';
import { MAX_IMAGE_BYTES } from './image-validation';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Get('config') @UseGuards(AuthGuard('jwt')) @Header('Cache-Control','no-store')
  config(){return this.uploadService.config();}
  @Post('media') @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MAX_IMAGE_BYTES,files:1,fields:4,fieldSize:200,parts:5}}))
  upload(@Req() req:any,@Body() dto:MediaUploadDto,@UploadedFile() file:{buffer:Buffer;mimetype:string}){return this.uploadService.upload(req.user,dto,file);}
  @Post('media/:id/confirm') @UseGuards(AuthGuard('jwt'))
  confirm(@Req() req:any,@Param('id') id:string,@Body() _body:EmptyMediaDto){return this.uploadService.confirm(req.user,id);}
  @Post('media/:id/commit-avatar') @UseGuards(AuthGuard('jwt'))
  commit(@Req() req:any,@Param('id') id:string,@Body() _body:EmptyMediaDto){return this.uploadService.commitAvatar(req.user,id);}
  @Delete('media/:id') @UseGuards(AuthGuard('jwt'))
  abandon(@Req() req:any,@Param('id') id:string){return this.uploadService.abandon(req.user,id);}
  @Get('media/:id/preview') @UseGuards(AuthGuard('jwt'))
  async preview(@Req() req:any,@Param('id') id:string,@Res() response:Response){
    this.sendImage(response,await this.uploadService.preview(req.user,id));
  }
  @Get('media/:id/file')
  async file(@Param('id') id:string,@Res() response:Response){
    this.sendImage(response,await this.uploadService.file(id));
  }
  private sendImage(response:Response,buffer:Buffer){
    response.set({'Content-Type':'image/webp','Content-Length':String(buffer.length),'X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="image.webp"','Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; sandbox"});
    response.send(buffer);
  }

  @Get('avatar-presigned')
  @UseGuards(AuthGuard('jwt'))
  async getAvatarPresignedUrl(@Req() req: any, @Query('ext') ext?: string) {
    return this.uploadService.generateAvatarPresignedUrl(req.user.id, ext || 'jpg');
  }

  @Post('avatar/confirm')
  @UseGuards(AuthGuard('jwt'))
  async confirmAvatarUpload(@Req() req: any, @Body('fileUrl') fileUrl: string) {
    return this.uploadService.confirmAvatar(req.user.id, fileUrl);
  }
}
