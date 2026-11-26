import { randomBytes } from 'node:crypto';
let localSecret: string | undefined;
export function jwtSecret() {
  const configured = process.env.JWT_SECRET;
  if (configured && Buffer.byteLength(configured, 'utf8') >= 32 && new Set(configured).size >= 12 && !/placeholder|change.?me|mjapp|example/i.test(configured)) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be a unique strong secret of at least 32 characters');
  return localSecret ??= randomBytes(48).toString('base64url');
}
