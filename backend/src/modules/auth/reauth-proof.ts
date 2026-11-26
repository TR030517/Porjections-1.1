import { createHmac, timingSafeEqual } from 'node:crypto';
import { jwtSecret } from './security';
const signature = (payload: string) => createHmac('sha256',jwtSecret()).update('customer-email-link-proof\0'+payload).digest('base64url');
export function emailReauthProof(userId: string, sessionId: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ purpose:'LINK_PROVIDER',userId,sessionId,expiresAt:now+300000 })).toString('base64url');
  return payload+'.'+signature(payload);
}
export function validEmailReauthProof(proof: string, userId: string, sessionId: string, now = Date.now()) {
  if (typeof proof !== 'string' || proof.length > 2048) return false;
  const parts=proof.split('.');if(parts.length!==2 || !parts.every(x=>/^[A-Za-z0-9_-]+$/.test(x)))return false;
  const actual=Buffer.from(parts[1]), expected=Buffer.from(signature(parts[0]));
  if(actual.length!==expected.length || !timingSafeEqual(actual,expected))return false;
  try { const value=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    return value.purpose==='LINK_PROVIDER' && value.userId===userId && value.sessionId===sessionId && Number.isSafeInteger(value.expiresAt) && value.expiresAt>now && value.expiresAt<=now+300000;
  } catch { return false; }
}
