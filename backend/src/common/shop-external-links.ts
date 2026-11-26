export interface ShopExternalLinks {
  website: string | null;
  instagram: string | null;
  facebook: string | null;
}

const FIELDS = ['website', 'instagram', 'facebook'] as const;
const SOCIAL_DOMAINS: Partial<Record<typeof FIELDS[number], string[]>> = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parse(value: unknown, field: typeof FIELDS[number]): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || input.length > 500 || /[\u0000-\u001f\u007f]/.test(input)) return null;
  try {
    const url = new URL(input), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !host || url.username || url.password) return null;
    const domains = SOCIAL_DOMAINS[field];
    if (domains && !domains.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
    return url.href;
  } catch { return null; }
}

export function normalizeShopExternalLinks(value: unknown): ShopExternalLinks {
  if (value === undefined || value === null) value = {};
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new Error('门店外链格式无效'); } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('门店外链格式无效');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !FIELDS.includes(key as typeof FIELDS[number]))) throw new Error('门店外链包含未知字段');
  const output = {} as ShopExternalLinks;
  for (const field of FIELDS) {
    const raw = input[field];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') throw new Error('门店外链格式无效');
    const checked = parse(raw, field);
    if (raw && !checked) throw new Error(field === 'website' ? '官网必须为有效的 HTTPS 链接' : `${field} 必须使用对应平台的 HTTPS 链接`);
    output[field] = checked;
  }
  return output;
}

export function publicShopExternalLinks(value: unknown): ShopExternalLinks {
  const input = object(value);
  return {
    website: parse(input.website, 'website'),
    instagram: parse(input.instagram, 'instagram'),
    facebook: parse(input.facebook, 'facebook'),
  };
}
