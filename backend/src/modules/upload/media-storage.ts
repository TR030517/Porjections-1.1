import { ServiceUnavailableException } from '@nestjs/common';
import { S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand } from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import path = require('node:path');
import { createHash } from 'node:crypto';
import { MAX_IMAGE_BYTES } from './image-validation';
export class MediaStorage {
  readonly driver:string;
  readonly namespace:string;
  private client:S3Client|null=null;
  private directory:string|null=null;
  private bucket:string|null=null;
  constructor(env:NodeJS.ProcessEnv=process.env){
    this.driver=env.MEDIA_STORAGE_DRIVER??'disabled';
    if(this.driver==='local'&&env.MEDIA_LOCAL_DIR&&path.isAbsolute(env.MEDIA_LOCAL_DIR)&&path.dirname(path.resolve(env.MEDIA_LOCAL_DIR))!==path.resolve(env.MEDIA_LOCAL_DIR))this.directory=path.resolve(env.MEDIA_LOCAL_DIR);
    if(this.driver==='s3'&&env.S3_BUCKET&&env.S3_ACCESS_KEY_ID&&env.S3_SECRET_ACCESS_KEY){
      try{if(env.S3_ENDPOINT){const u=new URL(env.S3_ENDPOINT);if(u.username||u.password||u.protocol!=='https:'&&!(env.NODE_ENV!=='production'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error();}
        this.bucket=env.S3_BUCKET;this.client=new S3Client({region:env.S3_REGION||'us-east-1',maxAttempts:2,requestHandler:{connectionTimeout:3000,requestTimeout:15000},...(env.S3_ENDPOINT?{endpoint:env.S3_ENDPOINT,forcePathStyle:true}:{}),credentials:{accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY}});
      }catch{this.client=null;this.bucket=null;}
    }
    this.namespace=createHash('sha256').update(JSON.stringify({driver:this.driver,dir:this.directory,bucket:this.bucket,endpoint:env.S3_ENDPOINT??null,region:env.S3_REGION??'us-east-1'})).digest('hex');
  }
  available(){return this.driver==='local'&&!!this.directory||this.driver==='s3'&&!!this.client;}
  require(){if(!this.available())throw new ServiceUnavailableException('MEDIA_STORAGE_NOT_CONFIGURED');}
  private key(value:string){if(!/^[a-f\d-]{36}\.webp$/.test(value))throw new Error('INVALID_MANAGED_STORAGE_KEY');return value;}
  private async localFile(key:string){this.require();await fs.mkdir(this.directory!,{recursive:true,mode:0o700});const root=await fs.realpath(this.directory!);const file=path.join(root,this.key(key));return{root,file};}
  async put(key:string,buffer:Buffer){this.require();this.key(key);
    try{if(this.driver==='local'){const{file}=await this.localFile(key);await fs.writeFile(file,buffer,{flag:'wx',mode:0o600});}
      else await this.client!.send(new PutObjectCommand({Bucket:this.bucket!,Key:this.key(key),Body:buffer,ContentType:'image/webp',ContentLength:buffer.length,CacheControl:'private, max-age=0',Metadata:{massajoy:'sanitized-image-v1'}}));
    }catch{throw new ServiceUnavailableException('MEDIA_STORAGE_WRITE_FAILED');}
  }
  async read(key:string){this.require();this.key(key);
    try{if(this.driver==='local'){const{file}=await this.localFile(key),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_IMAGE_BYTES)throw Error();return await fs.readFile(file);}
      const result=await this.client!.send(new GetObjectCommand({Bucket:this.bucket!,Key:this.key(key)}));if(!result.Body||!result.ContentLength||result.ContentLength>MAX_IMAGE_BYTES||result.ContentType!=='image/webp')throw Error();const bytes=Buffer.from(await result.Body.transformToByteArray());if(bytes.length>MAX_IMAGE_BYTES)throw Error();return bytes;
    }catch{throw new ServiceUnavailableException('MEDIA_STORAGE_READ_FAILED');}
  }
  async remove(key:string){this.require();this.key(key);
    try{if(this.driver==='local'){const{file}=await this.localFile(key);await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      else await this.client!.send(new DeleteObjectCommand({Bucket:this.bucket!,Key:this.key(key)}));
    }catch{throw new ServiceUnavailableException('MEDIA_STORAGE_DELETE_FAILED');}
  }
}
