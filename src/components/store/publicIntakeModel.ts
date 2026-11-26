import type { StoreItem } from './types';

const STORAGE_KEY = 'massajoy.admin.public-intake.pending.v1';
export interface PendingIntake { actorId: string; requestKey: string; packageDigest: string; createdAt: string }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const valid = (value: unknown): value is PendingIntake => !!value && typeof value === 'object'
  && typeof (value as PendingIntake).actorId === 'string' && /^[1-9]\d{0,18}$/.test((value as PendingIntake).actorId)
  && typeof (value as PendingIntake).requestKey === 'string' && /^[A-Za-z0-9:_-]{8,100}$/.test((value as PendingIntake).requestKey)
  && typeof (value as PendingIntake).packageDigest === 'string' && /^[a-f0-9]{64}$/.test((value as PendingIntake).packageDigest)
  && typeof (value as PendingIntake).createdAt === 'string' && Number.isFinite(Date.parse((value as PendingIntake).createdAt));
const storageKey = (actorId: string) => `${STORAGE_KEY}:${actorId}`;
export function readPendingIntake(storage: StoragePort, actorId: string): PendingIntake | null {
  try {
    const source = storage.getItem(storageKey(actorId));
    if (!source) return null;
    if (source.length > 500) { storage.removeItem(storageKey(actorId)); return null; }
    const data: unknown = JSON.parse(source);
    if (!valid(data) || data.actorId !== actorId) { storage.removeItem(storageKey(actorId)); return null; }
    return { actorId: data.actorId, requestKey: data.requestKey, packageDigest: data.packageDigest, createdAt: data.createdAt };
  } catch { return null; }
}
export function savePendingIntake(storage: StoragePort, value: PendingIntake) {
  if (!valid(value)) throw new Error('导入核对标识无效，尚未提交。');
  // Only recovery identifiers; never serialize the original file or business values.
  storage.setItem(storageKey(value.actorId), JSON.stringify({ actorId: value.actorId, requestKey: value.requestKey, packageDigest: value.packageDigest, createdAt: value.createdAt }));
}
export function clearPendingIntake(storage: StoragePort, expected: PendingIntake) {
  const current = readPendingIntake(storage, expected.actorId);
  if (current?.requestKey !== expected.requestKey || current.packageDigest !== expected.packageDigest) return;
  storage.removeItem(storageKey(expected.actorId));
}
export function createIntakeTemplate(items: Pick<StoreItem, 'id' | 'name' | 'shortName'>[], capturedAt = new Date().toISOString(), batchSuffix: string = crypto.randomUUID()) {
  const shops = items.slice(0, 20).map(item => ({ sourceEntity: 'merchant', sourceId: '', targetShopId: String(item.id), match: { name: item.name, shortName: item.shortName }, sourceUrls: [], description: '', rawCatalog: [] }));
  return { schemaVersion: 1, sourceSystem: 'massajoy1', batchId: `intake-template-${batchSuffix}`, capturedAt, shops };
}
export function intakeFieldValue(value: unknown): string {
  if (value == null || value === '') return '未填写';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const aliases = [['mon', 'monday', '周一', '星期一'], ['tue', 'tuesday', '周二', '星期二'], ['wed', 'wednesday', '周三', '星期三'], ['thu', 'thursday', '周四', '星期四'], ['fri', 'friday', '周五', '星期五'], ['sat', 'saturday', '周六', '星期六'], ['sun', 'sunday', '周日', '周天', '星期日', '星期天']];
    const order = new Map(aliases.flatMap((keys, index) => keys.map(key => [key, index] as const)));
    // MySQL JSON returns sorted object keys; both sides of the preview need the same week order.
    return Object.entries(value).sort(([a], [b]) => (order.get(a) ?? 7) - (order.get(b) ?? 7)).map(([day, raw]) => {
      const periods = Array.isArray(raw) ? raw : [raw];
      const formatted = periods.map(period => {
        if (!period || typeof period !== 'object') return '待核对';
        const entry = period as Record<string, unknown>;
        if (entry.closed === true || entry.open === false) return '休息';
        const start = entry.start ?? entry.open, end = entry.end ?? entry.close;
        return typeof start === 'string' && typeof end === 'string' ? `${start}–${end}` : '待核对';
      }).join(' / ');
      const index = order.get(day);
      return `${index === undefined ? day : labels[index]} ${formatted || '休息'}`;
    }).join('\n') || '未填写';
  }
  return '待核对';
}
