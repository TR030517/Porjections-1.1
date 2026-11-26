import type { ProjectCatalogAddOn } from './projectCatalog';
import { exactProjectId, projectWriteAllowed } from './projectRuleEdits';

export interface ProjectAddOnDraft { name: string; description: string; price: string; sortOrder: string; isActive: boolean; }
export interface ProjectAddOnPayload { name: string; description: string | null; priceCents: number; currency: 'usd'; sortOrder: number; isActive: boolean; }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function projectAddOnDraft(item?: ProjectCatalogAddOn): ProjectAddOnDraft {
  return { name: item?.name ?? '', description: item?.description ?? '', price: typeof item?.priceCents === 'number' && Number.isSafeInteger(item.priceCents) && item.priceCents >= 0 ? (item.priceCents / 100).toFixed(2) : '',
    sortOrder: item?.sortOrder == null ? '0' : String(item.sortOrder), isActive: item?.isActive ?? false };
}
function plain(value: string, max: number, required = false) {
  if (typeof value !== 'string' || value.length > max || /<\/?[a-z][^>]*>/iu.test(value) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || required && /[\r\n\t]/u.test(value)) throw Error('附加项须为有效纯文本，名称最多100字，说明最多1000字。');
  const text = value.replace(/\r\n?/g, '\n').trim(); if (required && !text) throw Error('请填写附加项名称。'); return text;
}
export function buildProjectAddOnPayload(draft: ProjectAddOnDraft): ProjectAddOnPayload {
  if (typeof draft.price !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(draft.price.trim())) throw Error('请填写0–100000美元的明确价格，最多两位小数。');
  const [whole, fraction = ''] = draft.price.trim().split('.'), priceCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > 10000000) throw Error('附加项价格须为0–100000美元。');
  if (typeof draft.sortOrder !== 'string' || !/^(?:0|[1-9]\d*)$/.test(draft.sortOrder) || Number(draft.sortOrder) > 10000 || typeof draft.isActive !== 'boolean') throw Error('请核对0–10000整数排序和启用状态。');
  return { name: plain(draft.name, 100, true), description: plain(draft.description, 1000) || null, priceCents, currency: 'usd', sortOrder: Number(draft.sortOrder), isActive: draft.isActive };
}
export function projectAddOnPath(shopId: unknown, serviceId: unknown, id?: string): string {
  const shop = exactProjectId(shopId), service = exactProjectId(serviceId);
  if (!shop || !service || id !== undefined && !exactProjectId(id)) throw Error('附加项门店或项目范围无法核对。');
  return '/reservation-admin/shops/' + shop + '/add-ons' + (id === undefined ? '' : '/' + id);
}
/** A successful HTTP status is insufficient: acknowledge this exact parent,
 * expected ID (for edits), and every requested field before reporting success. */
export function verifyProjectAddOnReceipt(raw: unknown, serviceId: string, payload: ProjectAddOnPayload, id?: string): ProjectCatalogAddOn {
  const row = object(raw) && object(raw.item) ? raw.item : undefined;
  if (!row || typeof row.id !== 'string' || !exactProjectId(row.id) || row.serviceId !== serviceId || id !== undefined && row.id !== id
    || Object.entries(payload).some(([key, value]) => row[key] !== value)) throw Error('附加项保存回执无法确认，请保留草稿并只读核对，勿重复新增。');
  return { id: row.id as string, serviceId, ...payload, preview: null };
}
/** One dispatched attempt owns the editor until acknowledged or explicitly
 * reconciled. Ambiguous writes can never be automatically retried as creates. */
export class ProjectAddOnAttempt {
  state: 'IDLE' | 'BUSY' | 'UNKNOWN' = 'IDLE';
  async save(input: { shopId: string; serviceId: string; id?: string; payload: ProjectAddOnPayload; current: () => boolean; beforeWrite: () => boolean;
    send: (path: string, method: 'POST' | 'PATCH', payload: ProjectAddOnPayload & { serviceId?: string }) => Promise<unknown> }): Promise<ProjectCatalogAddOn | null> {
    if (this.state !== 'IDLE') throw Error('上次保存结果尚未核对，不能重复提交。');
    const endpoint = projectAddOnPath(input.shopId, input.serviceId, input.id);
    if (!projectWriteAllowed(input.current, input.beforeWrite)) return null;
    this.state = 'BUSY';
    try {
      const raw = await input.send(endpoint, input.id === undefined ? 'POST' : 'PATCH', { ...input.payload, ...(input.id === undefined ? { serviceId: input.serviceId } : {}) });
      const saved = verifyProjectAddOnReceipt(raw, input.serviceId, input.payload, input.id);
      if (!input.current()) { this.state = 'UNKNOWN'; return null; }
      this.state = 'IDLE'; return saved;
    } catch (error) {
      const status = object(error) ? error.status : undefined;
      this.state = typeof status === 'number' && [400, 401, 403, 404, 409, 422, 429].includes(status) ? 'IDLE' : 'UNKNOWN';
      throw error;
    }
  }
}
