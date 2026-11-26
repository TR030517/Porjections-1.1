/** Framework-free allowlist shared by public shop and display-menu serializers. */
const SERVICE_GALLERY_PATH = /^\/service-gallery\/v1\/[a-z][a-z0-9-]{0,79}\.webp$/;

export function isServiceGalleryImagePath(value: unknown): value is string {
  return typeof value === 'string' && SERVICE_GALLERY_PATH.exec(value)?.[0] === value;
}

function safeMediaUrl(value: unknown, allowServiceGallery: boolean): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 500 || /[\s\\\u0000-\u001f\u007f]/u.test(raw)) return null;
  if (/^\/api\/v1\/upload\/media\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\/file$/.test(raw)) return raw;
  if (allowServiceGallery && isServiceGalleryImagePath(raw)) return raw;
  try { const url = new URL(raw); return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

/** Existing shop/logo/avatar callers do not opt into the menu subject gallery. */
export function safePublicMediaUrl(value: unknown): string | null {
  return safeMediaUrl(value, false);
}

/** Only display-menu normalization/projection may accept this fixed static path. */
export function safePriceMenuMediaUrl(value: unknown): string | null {
  return safeMediaUrl(value, true);
}
