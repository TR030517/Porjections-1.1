import { apiRequest } from './session';
import type { MediaPurpose, StagedMedia } from '../utils/mediaDraft';

export async function uploadShopMedia(shopId:string,file:File,purpose:MediaPurpose,requestKey:string) {
  const form=new FormData();form.set('file',file);form.set('scope','SHOP');form.set('shopId',shopId);form.set('purpose',purpose);form.set('requestKey',requestKey);
  const result=await apiRequest<{item:StagedMedia}>('/upload/media',{method:'POST',body:form});return result.item;
}
export async function confirmShopMedia(id:string) {const result=await apiRequest<{item:StagedMedia}>('/upload/media/'+encodeURIComponent(id)+'/confirm',{method:'POST',body:'{}'});return result.item;}
export function previewShopMedia(id:string):Promise<Blob> {
  return apiRequest('/upload/media/'+encodeURIComponent(id)+'/preview', {headers:{Accept:'image/webp'},cache:'no-store'}, response=>response.blob());
}
export async function abandonShopMedia(id:string) {const result=await apiRequest<{abandoned:boolean}>('/upload/media/'+encodeURIComponent(id),{method:'DELETE'});if(result?.abandoned!==true)throw new Error('未保存图片的清理结果无法确认。');return result;}
