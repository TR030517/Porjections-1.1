import { catalogDigest, catalogId, catalogRequestKey, type CatalogIdentity } from '../api/catalogImport';

export interface PendingCatalogImport extends CatalogIdentity { actorId: string; createdAt: string }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = (actorId: string) => `massajoy.admin.catalog-import.pending.v1:${actorId}`;
function valid(value: unknown): value is PendingCatalogImport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as PendingCatalogImport;
  return catalogId(data.actorId) && catalogId(data.shopId) && catalogRequestKey(data.requestKey) && catalogDigest(data.packageDigest)
    && typeof data.createdAt === 'string' && Number.isFinite(Date.parse(data.createdAt));
}
export function sameCatalogPending(a: PendingCatalogImport | null, b: PendingCatalogImport) {
  return !!a && a.actorId === b.actorId && a.shopId === b.shopId && a.requestKey === b.requestKey && a.packageDigest === b.packageDigest;
}
export function readPendingCatalog(storage: StoragePort, actorId: string): PendingCatalogImport | null {
  if (!catalogId(actorId)) return null;
  const source = storage.getItem(storageKey(actorId));
  if (!source) return null;
  let value: unknown;
  try { value = source.length <= 600 ? JSON.parse(source) : null; } catch { value = null; }
  if (!valid(value) || value.actorId !== actorId) { storage.removeItem(storageKey(actorId)); return null; }
  return { actorId: value.actorId, shopId: value.shopId, requestKey: value.requestKey, packageDigest: value.packageDigest, createdAt: value.createdAt };
}
export function savePendingCatalog(storage: StoragePort, marker: PendingCatalogImport) {
  if (!valid(marker)) throw new Error('价目导入核对标识无效，本次尚未提交。');
  const previous = readPendingCatalog(storage, marker.actorId);
  if (previous && !sameCatalogPending(previous, marker)) throw new Error('上次导入结果尚待核对，请先结束该请求。');
  storage.setItem(storageKey(marker.actorId), JSON.stringify({ actorId: marker.actorId, shopId: marker.shopId, requestKey: marker.requestKey, packageDigest: marker.packageDigest, createdAt: marker.createdAt }));
}
export function clearPendingCatalog(storage: StoragePort, expected: PendingCatalogImport) {
  if (!valid(expected) || !sameCatalogPending(readPendingCatalog(storage, expected.actorId), expected)) return false;
  storage.removeItem(storageKey(expected.actorId));
  return true;
}

/** Deliberately empty: the downloadable template never invents real services. */
export const CATALOG_TEMPLATE = '\uFEFFname,category,duration_minutes,price_usd,description\r\n';
export const CATALOG_EXAMPLE = 'name\tcategory\tduration_minutes\tprice_usd\tdescription\nExample Body Massage\t按摩\t60\t65.00\tReplace with your real English description\nExample Body Massage\t按摩\t90\t95.00\tReplace with your real English description';
