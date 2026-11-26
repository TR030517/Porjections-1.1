import { IsIn,IsOptional,IsString,Matches,MaxLength } from 'class-validator';
export class MediaUploadDto {
  @IsIn(['SHOP','AVATAR','BANNER']) scope!: 'SHOP'|'AVATAR'|'BANNER';
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,18}$/) shopId?:string;
  @IsIn(['logo','cover','gallery','menu','avatar','banner']) purpose!: 'logo'|'cover'|'gallery'|'menu'|'avatar'|'banner';
  @IsString() @MaxLength(80) @Matches(/^[A-Za-z0-9:_-]{8,80}$/) requestKey!:string;
}
export class EmptyMediaDto {}
