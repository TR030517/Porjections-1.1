import { apiRequest } from './session';
import type { BannerMedia } from '../utils/bannerDraft';

/** Platform images never borrow a shop's ownership or settings permission. */
export async function uploadBannerMedia(file: File, requestKey: string) {
  const form = new FormData();
  form.set('file', file);
  form.set('scope', 'BANNER');
  form.set('purpose', 'banner');
  form.set('requestKey', requestKey);
  const result = await apiRequest<{ item: BannerMedia }>('/upload/media', { method: 'POST', body: form });
  return result.item;
}

export async function confirmBannerMedia(id: string) {
  const result = await apiRequest<{ item: BannerMedia }>('/upload/media/' + encodeURIComponent(id) + '/confirm', { method: 'POST', body: '{}' });
  return result.item;
}

export async function abandonBannerMedia(id: string) {
  const result = await apiRequest<{ abandoned: boolean }>('/upload/media/' + encodeURIComponent(id), { method: 'DELETE' });
  if (result?.abandoned !== true) throw new Error('未保存轮播图片的清理结果无法确认。');
}
