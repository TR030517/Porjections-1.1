import { inspectMediaFile, MANAGED_MEDIA_PATH, MEDIA_MAX_BYTES } from './mediaDraft';

export interface BannerMedia {
  id: string; fileUrl: string; scope: 'BANNER'; shopId: null; purpose: 'banner';
  status: 'STAGED' | 'BOUND'; mimeType: string; sizeBytes: number;
  width: number; height: number; expiresAt: string;
}
export interface BannerMediaTransport {
  upload(file: File, key: string): Promise<BannerMedia>;
  confirm(id: string): Promise<BannerMedia>;
  abandon(id: string): Promise<unknown>;
}

function ownedIdentity(item: BannerMedia | undefined): item is BannerMedia {
  return !!item && item.scope === 'BANNER' && item.shopId === null && item.purpose === 'banner'
    && typeof item.id === 'string' && item.fileUrl === `/api/v1/upload/media/${item.id}/file` && MANAGED_MEDIA_PATH.test(item.fileUrl);
}

export function verifyBannerMedia(item: BannerMedia) {
  if (!ownedIdentity(item) || !['STAGED', 'BOUND'].includes(item.status) || item.mimeType !== 'image/webp'
    || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 || item.sizeBytes > MEDIA_MAX_BYTES
    || !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height) || item.width < 1 || item.height < 1
    || item.width > 8192 || item.height > 8192 || item.width * item.height > 25000000
    || item.status === 'STAGED' && (!Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) <= Date.now())) {
    throw new Error('轮播图片上传结果无法核对，原有图片和草稿保留。');
  }
  return item;
}

/** One editor owns one session. Upload/confirmation never save or enable a banner. */
export class BannerDraftSession {
  private active = true;
  private assets = new Map<string, BannerMedia>();
  private attempts = new Map<string, { key: string; item?: BannerMedia }>();
  private cleaning = new Map<string, Promise<boolean>>();

  constructor(private readonly transport: BannerMediaTransport) {}

  async upload(file: File) {
    if (!this.active) throw new Error('当前轮播编辑已结束。');
    const { digest } = await inspectMediaFile(file);
    if (!this.active) throw new Error('当前轮播编辑已结束。');
    let attempt = this.attempts.get(digest);
    if (!attempt) { attempt = { key: crypto.randomUUID() }; this.attempts.set(digest, attempt); }
    const item = attempt.item ?? await this.transport.upload(file, attempt.key);
    // Keep only this exact scope/identity for cleanup, including failed validation.
    if (ownedIdentity(item)) this.assets.set(item.id, item);
    if (!this.active) { await this.cleanup(); throw new Error('编辑已关闭，迟到的上传不会应用到其他轮播。'); }
    verifyBannerMedia(item); attempt.item = item;
    const confirmed = verifyBannerMedia(await this.transport.confirm(item.id));
    if (confirmed.id !== item.id || confirmed.fileUrl !== item.fileUrl) throw new Error('轮播图片确认结果不匹配。');
    if (!this.active) { await this.cleanup(); throw new Error('编辑已关闭，迟到的上传不会应用到其他轮播。'); }
    return confirmed.fileUrl;
  }

  /** Invoke only with the checked response from an explicit banner save. */
  async saved(imageUrl: string) {
    for (const [id, item] of this.assets) if (item.fileUrl === imageUrl) this.forget(id);
    return this.cleanup();
  }

  private forget(id: string) {
    this.assets.delete(id);
    for (const [digest, attempt] of this.attempts) if (attempt.item?.id === id) this.attempts.delete(digest);
  }

  private abandon(id: string): Promise<boolean> {
    const pending = this.cleaning.get(id);
    if (pending) return pending;
    const task = Promise.resolve().then(async () => {
      try { await this.transport.abandon(id); this.forget(id); return true; }
      catch (error) {
        // A response may be lost after a successful save. Bound assets stay server-owned.
        if ((error as { status?: number })?.status === 409) { this.forget(id); return true; }
        return false;
      } finally { this.cleaning.delete(id); }
    });
    this.cleaning.set(id, task);
    return task;
  }

  async cleanup() {
    const results = await Promise.all([...this.assets.keys()].map(id => this.abandon(id)));
    return results.filter(success => !success).length;
  }

  async dispose() { this.active = false; return this.cleanup(); }
}
