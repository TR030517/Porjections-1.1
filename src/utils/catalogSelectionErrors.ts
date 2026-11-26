import type { PriceMenuGroup } from './priceMenu';
import { sourceServiceIdForItem, type CatalogSelectionPrecondition } from './catalogSelection';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function catalogSelectionConflict(error: unknown, menu: PriceMenuGroup[]): string[] | null {
  if (!record(error)) return null;
  const response = record(error.response) ? error.response : undefined;
  const raw = response && record(response.data) ? response.data : error;
  const body = record(raw.error) ? raw.error : raw;
  if ((response?.status ?? error.status) !== 409 || body.code !== 'CATALOG_SELECTION_CHANGED') return null;
  const fields = record(body.fields) ? body.fields : {};
  const selected = menu.flatMap(group => group.items).filter(item => item.id && sourceServiceIdForItem(item, menu));
  const found = selected.filter(item => Object.hasOwn(fields, item.id!)).map(item => item.id!);
  return found.length ? found : selected.map(item => item.id!);
}
/** A refresh never acknowledges a changed source; only an explicit new selection does. */
export function remainingSelectionConflicts(ids: readonly string[], before: readonly CatalogSelectionPrecondition[], after: readonly CatalogSelectionPrecondition[], menu: PriceMenuGroup[]): string[] {
  const current = new Set(menu.flatMap(group => group.items).filter(item => sourceServiceIdForItem(item, menu)).map(item => item.id));
  return ids.filter(itemId => {
    if (!current.has(itemId)) return false;
    const previous = before.find(row => row.itemId === itemId), next = after.find(row => row.itemId === itemId);
    return !next || !!previous && previous.serviceId === next.serviceId && previous.expectedSelectionRevision === next.expectedSelectionRevision;
  });
}
