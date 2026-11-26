import type { PriceMenuGroup } from './priceMenu';

/** Workspace snapshots use a revision-bound read token for positions that never
 * had a stored ID. Keep that token inside the workspace; generic shop profiles
 * must retain the original missing-ID shape rather than persist the read token. */
export function workspaceProfileMenu(menu: PriceMenuGroup[]): PriceMenuGroup[] {
  const result = structuredClone(menu);
  for (const group of result) for (const item of group.items) {
    if (typeof item.id === 'string' && /^legacy:\d+:\d+:[a-f0-9]{16}$/.test(item.id)) delete item.id;
  }
  return result;
}
