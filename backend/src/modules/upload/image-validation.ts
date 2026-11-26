import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
// sharp 0.35's declaration exposes a default callable; its CommonJS runtime is the callable itself.
const sharp: typeof import('sharp').default = require('sharp');
export const MAX_IMAGE_BYTES=8*1024*1024;
export const MAX_IMAGE_PIXELS=25_000_000;
export const MAX_IMAGE_EDGE=8192;
export function imageMagic(data:Buffer) {
  if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return 'jpeg';
  if(data.length>=8&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return 'webp';
  return null;
}
export async function sanitizeImage(buffer:Buffer,mime:string){
  if(!Buffer.isBuffer(buffer)||!buffer.length)throw new BadRequestException('An image file is required');
  if(buffer.length>MAX_IMAGE_BYTES)throw new PayloadTooLargeException('Image exceeds 8 MiB');
  const format=imageMagic(buffer),expected=format==='jpeg'?'image/jpeg':format?`image/${format}`:null;
  if(!format||mime!==expected)throw new BadRequestException('Only matching JPEG, PNG or WebP files are accepted');
  try{
    const options={failOn:'warning' as const,limitInputPixels:MAX_IMAGE_PIXELS,animated:false};
    const metadata=await sharp(buffer,options).metadata();
    if(metadata.format!==format||!metadata.width||!metadata.height||metadata.width>MAX_IMAGE_EDGE||metadata.height>MAX_IMAGE_EDGE||metadata.width*metadata.height>MAX_IMAGE_PIXELS||(metadata.pages??1)!==1)throw Error();
    // Full decode + re-encode. No original metadata, original filename or original executable bytes are stored.
    const result=await sharp(buffer,options).timeout({seconds:10}).rotate().webp({quality:85,effort:4}).toBuffer({resolveWithObject:true});
    if(result.data.length>MAX_IMAGE_BYTES)throw new PayloadTooLargeException('Sanitized image exceeds 8 MiB');
    return{buffer:result.data,mimeType:'image/webp',width:result.info.width,height:result.info.height,sizeBytes:result.data.length};
  }catch(error){if(error instanceof PayloadTooLargeException)throw error;throw new BadRequestException('Image cannot be safely decoded, is animated, or exceeds image dimensions');}
}
