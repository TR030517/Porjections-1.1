/// <reference types="vite/client" />
/** Development has separate frontends; deployed links retain the site's origin. */
export function customerSiteOrigin(currentOrigin: string): string {
  const configured = import.meta.env.VITE_CUSTOMER_ORIGIN?.trim();
  if (configured) {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('顾客站点地址配置无效');
    return url.origin;
  }
  return import.meta.env.DEV ? 'http://127.0.0.1:3004' : currentOrigin;
}
