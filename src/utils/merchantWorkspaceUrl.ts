/// <reference types="vite/client" />
const MERCHANT_DEV_ORIGIN = 'http://127.0.0.1:3002';

export function merchantWorkspaceUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : '/' + path;
  return import.meta.env.DEV
    ? MERCHANT_DEV_ORIGIN + '/merchant' + normalized
    : '/merchant' + normalized;
}
