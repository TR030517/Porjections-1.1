// No credentials or account data. Keep an explicit sign-out across full reloads,
// including when the server never receives the logout request.
const key = 'massajoy:management:explicit-logout:v1';
const cookie = 'massajoy_management_signed_out';
let memory: string | null = null;
export function logoutIntent(): string | null {
  if (typeof window === 'undefined') return memory;
  let stored: string | null = null, cookieValue: string | null = null, storageReadable = false, cookieReadable = false;
  try { stored = window.localStorage?.getItem(key) ?? null; storageReadable = !!window.localStorage; } catch { /* Read cookie fallback. */ }
  try {
    if (typeof document !== 'undefined') {
      const match = document.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(cookie + '='));
      cookieValue = match ? match.slice(cookie.length + 1) : null; cookieReadable = true;
    }
  } catch { /* Storage fallback remains usable. */ }
  return cookieValue || stored || memory || (!storageReadable && !cookieReadable ? 'storage-unavailable' : null);
}
export function markExplicitLogout(): void {
  memory = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  try { window.localStorage?.setItem(key, memory); } catch { /* Cookie fallback. */ }
  try { if (typeof document !== 'undefined') document.cookie = `${cookie}=${memory}; Path=/; SameSite=Strict; Max-Age=31536000`; } catch { /* Storage fallback. */ }
}
export function acceptExplicitLogin(expected: string | null): boolean {
  if (logoutIntent() !== expected) return false;
  try { window.localStorage?.removeItem(key); } catch { /* Cookie fallback. */ }
  try { if (typeof document !== 'undefined') document.cookie = `${cookie}=; Path=/; SameSite=Strict; Max-Age=0`; } catch { /* Storage fallback. */ }
  memory = null;
  return true;
}
