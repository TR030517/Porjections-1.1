import { formatPublicShopAddress } from '../../backend/src/common/public-shop-address';

/** Links use only explicitly public store contacts; never accept arbitrary URLs. */
const controls = /[\u0000-\u001f\u007f]/;
export interface PublicContact { label: string; href: string; }

export function publicPhone(value: unknown): PublicContact | null {
  if (typeof value !== 'string' || controls.test(value)) return null;
  const label = value.trim();
  if (!label || label.length > 40 || !/^\+?[0-9 ().-]+$/.test(label)) return null;
  const digits = label.replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return { label, href: 'tel:' + (label.startsWith('+') ? '+' : '') + digits };
}

export function publicEmail(value: unknown): PublicContact | null {
  if (typeof value !== 'string' || controls.test(value)) return null;
  const label = value.trim();
  if (!label || label.length > 255) return null;
  const parts = label.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (local.length > 64 || !/^[A-Za-z0-9._+-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(part => part.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(part))) return null;
  return { label, href: 'mailto:' + label };
}

export function publicContactList(values: unknown, kind: 'phone' | 'email'): PublicContact[] {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) return [];
  const result: PublicContact[] = [], seen = new Set<string>();
  for (const value of values) {
    const contact = kind === 'phone' ? publicPhone(value) : publicEmail(value);
    if (!contact) continue;
    const key = kind === 'email' ? contact.href.toLowerCase() : contact.href;
    if (seen.has(key)) continue;
    seen.add(key); result.push(contact);
    if (result.length === 5) break;
  }
  return result;
}

export function publicStoreMap(address: unknown, city?: unknown, state?: unknown, zipCode?: unknown): string | null {
  if (typeof address !== 'string' || !address.trim()) return null;
  const values = [address, city, state, zipCode];
  if (values.some(value => value != null && (typeof value !== 'string' || controls.test(value) || value.length > 500))) return null;
  const query = formatPublicShopAddress(address, city, state, zipCode);
  return 'https://www.google.com/maps/search/?' + new URLSearchParams({ api: '1', query }).toString();
}
