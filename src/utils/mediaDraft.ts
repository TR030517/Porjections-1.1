export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const MANAGED_MEDIA_PATH = /^\/api\/v1\/upload\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/file$/i;
export type ShopProfileMediaPurpose = 'logo' | 'cover' | 'gallery';
export type MediaPurpose = ShopProfileMediaPurpose | 'menu';
export interface StagedMedia { id: string; fileUrl: string; scope: 'SHOP'; shopId: string; purpose: MediaPurpose; status: 'STAGED'; mimeType: string; sizeBytes: number; width: number; height: number; expiresAt: string; }
export interface UploadedShopMedia { url: string; replacesUrl?: string; }
export interface MediaDraftTransport {
  upload(file: File,purpose:MediaPurpose,key:string):Promise<StagedMedia>;
  confirm(id:string):Promise<StagedMedia>;
  preview?(id:string):Promise<Blob>;
  abandon(id:string):Promise<unknown>;
}
type UploadFailure = {
  status?: number;
  code?: unknown;
  response?: { status?: number; data?: { code?: unknown; error?: { code?: unknown } } };
};

export class ShopMediaUploadRecoveryError extends Error {
  readonly restart: boolean;
  constructor(restart: boolean) {
    super(restart ? '原上传已失效。可重新上传同一文件。' : '原上传仍在处理中。请稍等后重试原文件。');
    this.restart = restart;
  }
}

function uploadRecovery(error: unknown) {
  const failure = error as UploadFailure | undefined;
  const { status, code } = failure?.response
    ? { status: failure.response.status, code: failure.response.data?.error?.code ?? failure.response.data?.code }
    : { status: failure?.status, code: failure?.code };
  if ((status === 409 || status === 503) && code === 'SHOP_MEDIA_UPLOAD_TERMINAL') return new ShopMediaUploadRecoveryError(true);
  if (status === 409 && code === 'SHOP_MEDIA_UPLOAD_PENDING') return new ShopMediaUploadRecoveryError(false);
}

type MediaAttempt = { key: string; item?: StagedMedia; displayedUrl?: string; terminal?: boolean };
export async function inspectMediaFile(file:File) {
  if(!file.size||file.size>MEDIA_MAX_BYTES)throw new Error('请选择不超过 8 MiB 的 JPEG、PNG 或 WebP 图片。');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const png=[137,80,78,71,13,10,26,10];
  const mime=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.length>=8&&png.every((value,index)=>bytes[index]===value)?'image/png':bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
  if(!mime||(file.type&&file.type.toLowerCase()!==mime))throw new Error('图片格式与实际内容不符，请选择 JPEG、PNG 或 WebP。');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return {mime,digest:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')};
}
export function verifyStagedMedia(item:StagedMedia,shopId:string,purpose?:MediaPurpose) {
  if(!item||typeof item.id!=='string'||item.fileUrl!==`/api/v1/upload/media/${item.id}/file`||!MANAGED_MEDIA_PATH.test(item.fileUrl)||item.scope!=='SHOP'||item.shopId!==shopId||item.status!=='STAGED'||(purpose&&item.purpose!==purpose)||!['image/jpeg','image/png','image/webp'].includes(item.mimeType)||!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<1||item.sizeBytes>MEDIA_MAX_BYTES||!Number.isSafeInteger(item.width)||!Number.isSafeInteger(item.height)||item.width<1||item.height<1||item.width>8192||item.height>8192||item.width*item.height>25000000)throw new Error('上传结果无法核对，请重试或重新加载，不会使用未经确认的图片地址。');
  return item;
}
/** Staging never edits a shop. Only its normal explicit save binds the returned URL. */
export class MediaDraftSession {
  private active=true;
  private assets=new Map<string,StagedMedia>();
  private attempts=new Map<string,MediaAttempt>();
  private previews=new Map<string,string>();
  private cleaning=new Map<string,Promise<boolean>>();
  get previewUrls():ReadonlyMap<string,string> { return this.previews; }
  get hasStagedAssets() { return this.assets.size > 0; }
  get stagedAssets(): readonly StagedMedia[] {
    return [...this.assets.values()].filter(item => {
      try { verifyStagedMedia(item, this.shopId); return true; }
      catch { return false; }
    });
  }
  private readonly shopId:string;
  private readonly transport:MediaDraftTransport;
  constructor(shopId:string,transport:MediaDraftTransport){this.shopId=shopId;this.transport=transport;}
  activate(){this.active=true;}
  isStagedUrl(url: string) { return [...this.assets.values()].some(item => item.fileUrl === url); }
  restoreStagedAssets(items: readonly StagedMedia[], purpose: MediaPurpose) {
    const verified = items.map(item => verifyStagedMedia(item, this.shopId, purpose));
    for (const item of verified) this.assets.set(item.id, item);
  }
  async upload(file:File,purpose:MediaPurpose): Promise<UploadedShopMedia> {
    if(!this.active)throw new Error('当前编辑已结束。');
    const {digest}=await inspectMediaFile(file);const fingerprint=`${purpose}:${digest}`;
    if(!this.active)throw new Error('当前编辑已结束。');
    let attempt=this.attempts.get(fingerprint);
    if (!attempt || attempt.terminal) {
      attempt = { key: crypto.randomUUID(), displayedUrl: attempt?.displayedUrl };
      this.attempts.set(fingerprint, attempt);
    }
    try {
      const item=attempt.item??await this.transport.upload(file,purpose,attempt.key);
      // Retain the exact owned identity for cleanup even if the rest of the response is malformed.
      if(item?.shopId===this.shopId&&MANAGED_MEDIA_PATH.test(item.fileUrl??'')&&item.fileUrl===`/api/v1/upload/media/${item.id}/file`)this.assets.set(item.id,item);
      if(!this.active){await this.cleanup();throw new Error('编辑已关闭，本次未保存图片不会应用到其他门店。');}
      verifyStagedMedia(item,this.shopId,purpose);attempt.item=item;
      const confirmed=verifyStagedMedia(await this.transport.confirm(item.id),this.shopId,purpose);
      if(confirmed.id!==item.id||confirmed.fileUrl!==item.fileUrl)throw new Error('图片确认结果不匹配。');
      if(this.active && this.transport.preview && !this.previews.has(confirmed.fileUrl)) {
        const image=await this.transport.preview(confirmed.id);
        if(this.active && !this.previews.has(confirmed.fileUrl)) {
          if(image.type!=='image/webp'||image.size!==confirmed.sizeBytes)throw new Error('暂存图片预览无法核对，请重试。');
          this.previews.set(confirmed.fileUrl,URL.createObjectURL(image));
        }
      }
      if(!this.active){await this.cleanup();throw new Error('编辑已关闭，本次未保存图片不会应用到其他门店。');}
      const replacesUrl = attempt.displayedUrl;
      const url = confirmed.fileUrl;
      attempt.displayedUrl = url;
      return replacesUrl && replacesUrl !== url ? { url, replacesUrl } : { url };
    } catch (error) {
      const recovery = uploadRecovery(error);
      if (!recovery) throw error;
      if (recovery.restart) attempt.terminal = true;
      throw recovery;
    }
  }
  async saved(urls:readonly string[]) {
    const bound=new Set(urls);
    for(const [id,item] of this.assets){if(bound.has(item.fileUrl))this.forget(id,item.fileUrl);}
    return this.cleanup();
  }
  async cleanup() {
    const results = await Promise.all([...this.assets].map(([id, item]) => {
      const existing = this.cleaning.get(id);
      if (existing) return existing;
      const abandon = async () => {
        try { await this.transport.abandon(id); }
        catch (error) {
          const failure = error as UploadFailure | undefined;
          if ((failure?.status ?? failure?.response?.status) !== 409) return false;
        }
        this.forget(id, item.fileUrl);
        return true;
      };
      const request = abandon().finally(() => this.cleaning.delete(id));
      this.cleaning.set(id, request);
      return request;
    }));
    return results.filter(result => !result).length;
  }
  private forget(id:string,fileUrl:string) {
    this.assets.delete(id);
    this.dropPreview(fileUrl);
    for(const [fingerprint,attempt] of this.attempts)if(attempt.item?.id===id)this.attempts.delete(fingerprint);
  }
  private dropPreview(fileUrl:string) {
    const preview=this.previews.get(fileUrl);
    if(preview)URL.revokeObjectURL(preview);
    this.previews.delete(fileUrl);
  }
  releasePreviews() {
    for(const fileUrl of this.previews.keys())this.dropPreview(fileUrl);
  }
  async dispose(){
    this.active=false;
    this.releasePreviews();
    return this.cleanup();
  }
}
