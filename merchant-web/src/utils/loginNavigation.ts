const allowedPaths = new Set([
  '/', '/dashboard', '/bookings', '/reservations', '/after-sales', '/gifts',
  '/services', '/technicians', '/earnings', '/coupons', '/settings',
  '/price-menu', '/copy-config', '/staff',
]);
const internalOrigin = 'https://merchant-navigation.invalid';

/** React Router paths are relative to /merchant, never arbitrary redirect URLs. */
export function safeMerchantReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') ||
      value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const target = new URL(value, internalOrigin);
    const rawPath = value.split(/[?#]/, 1)[0];
    if (target.origin !== internalOrigin || rawPath !== target.pathname || !allowedPaths.has(target.pathname)) return null;
    return target.pathname + target.search + target.hash;
  } catch { return null; }
}

function requestedShop(params: URLSearchParams): string | null {
  const values = params.getAll('shopId');
  return values.length === 1 && /^[1-9]\d*$/.test(values[0]) ? values[0] : null;
}

export function merchantLoginHref(pathname: string, search = '', hash = ''): string {
  const params = new URLSearchParams();
  const shop = requestedShop(new URLSearchParams(search));
  if (shop) params.set('shopId', shop);
  const target = safeMerchantReturnTo(pathname + search + hash);
  if (target) params.set('returnTo', target);
  return '/login' + (params.size ? '?' + params.toString() : '');
}

export function merchantPostLoginTarget(search: string): string {
  const params = new URLSearchParams(search);
  const targets = params.getAll('returnTo');
  const target = targets.length === 1 ? safeMerchantReturnTo(targets[0]) : null;
  if (target) return target;
  const shop = requestedShop(params);
  return shop ? '/?shopId=' + encodeURIComponent(shop) : '/';
}
