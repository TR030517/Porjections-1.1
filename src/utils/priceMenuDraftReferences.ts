import type { PriceMenuGroup, PriceMenuItem } from './priceMenu';

interface Entry {
  item: PriceMenuItem;
  groupIndex: number;
  removed: boolean;
}
type Anchor = { kind: 'service'; serviceId: string } | { kind: 'draft'; root: Entry };
const localParentId = (item: PriceMenuItem) => item.newVariantOf?.startsWith('item:') ? item.newVariantOf.slice(5) : undefined;
const anchorKey = (anchor: Anchor): string | Entry => anchor.kind === 'service' ? `service:${anchor.serviceId}` : anchor.root;

/** Repair only explicit draft references broken by this deletion. Titles never
 * determine a family, and existing missing/cyclic references stay invalid. */
function removeAndRepair(menu: PriceMenuGroup[], groupIndex: number, itemIndex?: number): PriceMenuGroup[] {
  const entries = menu.flatMap((group, groupAt) => group.items.map((item, itemAt): Entry => ({
    item, groupIndex: groupAt,
    removed: groupAt === groupIndex && (itemIndex === undefined || itemAt === itemIndex),
  })));
  const remaining = entries.filter(entry => !entry.removed);
  const remainingIds = new Set(remaining.flatMap(entry => entry.item.id ? [entry.item.id] : []));
  const removedIds = new Set(entries.flatMap(entry => entry.removed && entry.item.id && !remainingIds.has(entry.item.id) ? [entry.item.id] : []));
  const byId = new Map<string, Entry>(), duplicateIds = new Set<string>();
  for (const entry of entries) if (entry.item.id) {
    if (byId.has(entry.item.id)) duplicateIds.add(entry.item.id);
    else byId.set(entry.item.id, entry);
  }
  const anchors = new Map<Entry, Anchor | null>();
  const trace = (start: Entry): Anchor | null => {
    const path: Entry[] = [], visited = new Set<Entry>();
    let entry: Entry | undefined = start, result: Anchor | null = null;
    while (entry) {
      if (anchors.has(entry)) { result = anchors.get(entry)!; break; }
      if (visited.has(entry)) break;
      visited.add(entry); path.push(entry);
      if (entry.item.booking?.addOnId || entry.item.pricing?.kind === 'ADD_ON') break;
      if (entry.item.booking) { result = { kind: 'service', serviceId: entry.item.booking.serviceId }; break; }
      const parent: string | undefined = entry.item.newVariantOf;
      if (!parent) { result = { kind: 'draft', root: entry }; break; }
      if (!parent.startsWith('item:')) {
        if (/^[1-9]\d{0,18}$/.test(parent)) result = { kind: 'service', serviceId: parent };
        break;
      }
      const id: string = parent.slice(5);
      entry = duplicateIds.has(id) ? undefined : byId.get(id);
    }
    for (const part of path) anchors.set(part, result);
    return result;
  };
  const broken = remaining.filter(entry => {
    const id = localParentId(entry.item);
    return id !== undefined && removedIds.has(id);
  });
  const families = new Map<string | Entry, Anchor>();
  for (const entry of broken) {
    const anchor = trace(entry);
    if (anchor) families.set(anchorKey(anchor), anchor);
  }
  const changed = new Map<Entry, PriceMenuItem>();
  const setParent = (entry: Entry, parent: string | undefined) => {
    const item = changed.get(entry) ?? entry.item;
    if (item.newVariantOf === parent) return;
    const next = { ...item };
    if (parent === undefined) delete next.newVariantOf;
    else next.newVariantOf = parent;
    changed.set(entry, next);
  };
  for (const [key, anchor] of families) {
    const family = remaining.filter(entry => {
      const actual = trace(entry);
      return actual !== null && anchorKey(actual) === key;
    });
    let replacement: Entry | undefined;
    let parent: string;
    if (anchor.kind === 'service') parent = anchor.serviceId;
    else {
      replacement = !anchor.root.removed ? anchor.root
        : family.find(entry => entry.groupIndex === anchor.root.groupIndex) ?? family[0];
      if (!replacement) continue;
      // UI-created rows already have IDs. A legacy anonymous leaf can inherit
      // its deleted draft root's unused ID without generating a new identity.
      const id = replacement.item.id ?? anchor.root.item.id;
      if (!id) continue;
      if (!replacement.item.id) changed.set(replacement, { ...replacement.item, id });
      setParent(replacement, undefined);
      parent = `item:${id}`;
    }
    for (const entry of broken) {
      const actual = trace(entry);
      if (entry !== replacement && actual && anchorKey(actual) === key) setParent(entry, parent);
    }
  }
  return menu.flatMap((group, groupAt) => {
    if (itemIndex === undefined && groupAt === groupIndex) return [];
    const items = entries.filter(entry => entry.groupIndex === groupAt && !entry.removed).map(entry => changed.get(entry) ?? entry.item);
    return [items.length === group.items.length && items.every((item, at) => item === group.items[at]) ? group : { ...group, items }];
  });
}

export function removePriceMenuDraftItem(menu: PriceMenuGroup[], groupIndex: number, itemIndex: number): PriceMenuGroup[] {
  if (!Number.isInteger(groupIndex) || !Number.isInteger(itemIndex) || !menu[groupIndex]?.items[itemIndex]) return menu;
  return removeAndRepair(menu, groupIndex, itemIndex);
}

export function removePriceMenuDraftGroup(menu: PriceMenuGroup[], groupIndex: number): PriceMenuGroup[] {
  if (!Number.isInteger(groupIndex) || !menu[groupIndex]) return menu;
  return removeAndRepair(menu, groupIndex);
}
