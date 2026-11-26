import type { StoreItem } from '../components/store/types';

type LinkRow = Pick<StoreItem, 'id' | 'shortName' | 'canonicalShortName' | 'canonicalPath'>;
export type SavedStoreShortLink = Required<Pick<LinkRow, 'id' | 'shortName' | 'canonicalShortName' | 'canonicalPath'>>;

/** The input is a suffix, never a URL. Keep rejected characters visible to the operator. */
export function storeShortLinkDraft(value: string): { shortName: string; path: string } | null {
  const shortName = value.trim().toLowerCase();
  return shortName.length >= 3 && shortName.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shortName)
    ? { shortName, path: '/s/' + shortName } : null;
}

export function savedStoreShortLink(value: unknown, shopId: StoreItem['id'], submitted: string): SavedStoreShortLink {
  const expected = storeShortLinkDraft(submitted);
  const row = value && typeof value === 'object' ? value as Partial<LinkRow> : null;
  const exactId = (id: unknown) => typeof id === 'string' ? id : typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : null;
  if (!expected || !row || exactId(row.id) !== exactId(shopId) || exactId(shopId) === null
    || row.shortName !== expected.shortName || row.canonicalShortName !== expected.shortName || row.canonicalPath !== expected.path) {
    throw new Error('短链保存回执与本店或提交内容不一致，请刷新门店列表核对后再修改。');
  }
  return { id: shopId, shortName: expected.shortName, canonicalShortName: expected.shortName, canonicalPath: expected.path };
}

/** A short-link command must not overwrite fresher publication, account or booking data. */
export function applyStoreShortLink<T extends LinkRow>(row: T, saved: SavedStoreShortLink): T {
  return String(row.id) === String(saved.id)
    ? { ...row, shortName: saved.shortName, canonicalShortName: saved.canonicalShortName, canonicalPath: saved.canonicalPath } : row;
}

export function reconcileStoreShortLinkDrafts(drafts: Record<string, string>, previous: LinkRow[], next: LinkRow[]): Record<string, string> {
  const saved = new Map(previous.map(row => [String(row.id), row.canonicalShortName ?? row.shortName ?? '']));
  return Object.fromEntries(next.map(row => {
    const key = String(row.id), draft = drafts[key], before = saved.get(key);
    return [key, draft !== undefined && before !== undefined && draft.trim().toLowerCase() !== before
      ? draft : row.canonicalShortName ?? row.shortName ?? ''];
  }));
}
