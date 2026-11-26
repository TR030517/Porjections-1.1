import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createPublicKey, verify } from 'node:crypto';
export type IdentityProvider = 'GOOGLE' | 'APPLE';
export type VerifiedIdentity = { provider: IdentityProvider; subject: string; nonce: string; email?: string; emailVerified: boolean; name?: string };
type Keys = { keys: Record<string, any>[] };
const ENDPOINTS = { GOOGLE: 'https://www.googleapis.com/oauth2/v3/certs', APPLE: 'https://appleid.apple.com/auth/keys' };
function clients(provider: IdentityProvider, env: NodeJS.ProcessEnv) {
  return (env[`AUTH_${provider}_CLIENT_IDS`] || '').split(',').map(x => x.trim()).filter(x => x.length > 0 && x.length <= 255 && !/\s/.test(x));
}
export function identityConfig(provider: IdentityProvider, env = process.env) {
  const allowed = clients(provider, env), webClientId = env[`AUTH_${provider}_WEB_CLIENT_ID`]?.trim();
  const redirectUri = env.AUTH_APPLE_WEB_REDIRECT_URI?.trim();
  let webEnabled = !!webClientId && allowed.includes(webClientId);
  if (provider === 'APPLE') {
    try { const u = new URL(redirectUri || ''); webEnabled &&= u.protocol === 'https:' && !u.username && !u.password && !u.hash; } catch { webEnabled = false; }
  }
  return { enabled: allowed.length > 0, webEnabled, ...(webEnabled ? { webClientId, ...(provider === 'APPLE' ? { redirectUri } : {}) } : {}), ...(!allowed.length ? { reason: 'IDENTITY_PROVIDER_NOT_CONFIGURED' } : {}) };
}
function segment(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new UnauthorizedException('Invalid identity token');
  try { const data = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw new UnauthorizedException('Invalid identity token'); }
}
@Injectable()
export class IdentityVerifier {
  private cache = new Map<IdentityProvider, { expires: number; keys: Keys; fetchedAt: number }>();
  private pending = new Map<IdentityProvider, Promise<Keys>>();
  constructor() {}
  // Test seam uses synthetic keys; production callers never supply a URL or transport.
  protected async loadKeys(provider: IdentityProvider, force = false): Promise<Keys> {
    const existing = this.cache.get(provider); if (existing && (!force && existing.expires > Date.now() || force && Date.now() - existing.fetchedAt < 30000)) return existing.keys;
    if (this.pending.has(provider)) return this.pending.get(provider)!;
    const promise = (async () => {
      try {
        const response = await fetch(ENDPOINTS[provider], { redirect: 'error', signal: AbortSignal.timeout(8000) });
        if (!response.ok || Number(response.headers.get('content-length') || 0) > 100000) throw new Error();
        const text = await response.text(); if (text.length > 100000) throw new Error();
        const body = JSON.parse(text) as Keys;
        if (!Array.isArray(body.keys) || body.keys.length > 30) throw new Error();
        const maxAge = Math.min(3600, Math.max(60, Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]) || 300));
        this.cache.set(provider, { keys: body, expires: Date.now() + maxAge * 1000, fetchedAt: Date.now() }); return body;
      } catch { throw new ServiceUnavailableException('Identity verification is temporarily unavailable'); }
      finally { this.pending.delete(provider); }
    })(); this.pending.set(provider, promise); return promise;
  }
  async verify(provider: IdentityProvider, token: string): Promise<VerifiedIdentity> {
    const allowed = clients(provider, process.env); if (!allowed.length) throw new ServiceUnavailableException('Identity provider is not configured');
    if (typeof token !== 'string' || token.length > 16000) throw new BadRequestException('Invalid identity token');
    const parts = token.split('.'); if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new UnauthorizedException('Invalid identity token');
    const h = segment(parts[0]), p = segment(parts[1]);
    if (h.alg !== 'RS256' || typeof h.kid !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(h.kid) || h.jku || h.x5u || h.crit || (h.typ && h.typ !== 'JWT')) throw new UnauthorizedException('Invalid identity token');
    let keys = await this.loadKeys(provider);
    const matching = (body: Keys) => body.keys.filter(k => k.kid === h.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
    if (!matching(keys).length) keys = await this.loadKeys(provider, true);
    const matches = matching(keys);
    if (matches.length !== 1) throw new UnauthorizedException('Unknown identity signing key');
    let valid = false;
    try { const key = createPublicKey({ key: matches[0] as any, format: 'jwk' }); if ((key.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error(); valid = verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url')); } catch { /* fixed rejection */ }
    if (!valid) throw new UnauthorizedException('Invalid identity signature');
    const now = Math.floor(Date.now() / 1000), issuer = provider === 'APPLE' ? ['https://appleid.apple.com'] : ['https://accounts.google.com', 'accounts.google.com'];
    if (!issuer.includes(p.iss) || typeof p.aud !== 'string' || !allowed.includes(p.aud) || (p.azp !== undefined && p.azp !== p.aud)
      || !Number.isSafeInteger(p.exp) || !Number.isSafeInteger(p.iat) || p.exp <= now || p.iat > now + 60 || p.iat < now - 600 || p.exp <= p.iat || (p.nbf !== undefined && (!Number.isSafeInteger(p.nbf) || p.nbf > now + 30))
      || typeof p.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(p.sub) || typeof p.nonce !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(p.nonce)) throw new UnauthorizedException('Invalid identity claims');
    const emailVerified = p.email_verified === true || p.email_verified === 'true';
    const email = typeof p.email === 'string' && p.email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) ? p.email.toLowerCase() : undefined;
    return { provider, subject: p.sub, nonce: p.nonce, email: emailVerified ? email : undefined, emailVerified: !!email && emailVerified, name: typeof p.name === 'string' ? p.name.trim().slice(0, 100) : undefined };
  }
}
