import client from './client';
import type { MediaPurpose, StagedMedia } from '../../../src/utils/mediaDraft';

export async function uploadShopMedia(shopId:string,file:File,purpose:MediaPurpose,requestKey:string):Promise<StagedMedia> {
  const body=new FormData();body.set('file',file);body.set('scope','SHOP');body.set('shopId',shopId);body.set('purpose',purpose);body.set('requestKey',requestKey);
  const {data}=await client.post('/upload/media',body,{headers:{'Content-Type':undefined}});return data.item;
}
export async function confirmShopMedia(id:string):Promise<StagedMedia>{const {data}=await client.post('/upload/media/'+encodeURIComponent(id)+'/confirm',{});return data.item;}
export async function previewShopMedia(id: string): Promise<Blob> {
  const { data } = await client.get<Blob>('/upload/media/' + encodeURIComponent(id) + '/preview', {
    responseType: 'blob',
    headers: { Accept: 'image/webp' },
  });
  return data;
}
export async function abandonShopMedia(id:string){const {data}=await client.delete('/upload/media/'+encodeURIComponent(id));if(data?.abandoned!==true)throw new Error('无法确认未使用图片是否已清理。');return data;}
