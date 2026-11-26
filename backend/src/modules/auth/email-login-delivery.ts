import { Injectable, ServiceUnavailableException } from '@nestjs/common';
export function emailLoginConfig(env = process.env) {
  const devOnly = env.NODE_ENV !== 'production' && env.AUTH_EMAIL_LOCAL_OTP === 'true';
  const from = env.AUTH_EMAIL_FROM?.trim() || '';
  const enabled = devOnly || env.AUTH_EMAIL_PROVIDER === 'resend' && !!env.AUTH_EMAIL_API_KEY?.trim() && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from);
  return { enabled: !!enabled, devOnly, ...(!enabled ? { reason: 'EMAIL_LOGIN_NOT_CONFIGURED' } : {}) };
}
@Injectable()
export class EmailLoginDelivery {
  async send(email: string, code: string, challengeId: string) {
    return this.sendCode(email, code, challengeId, false);
  }
  async sendPasswordRecovery(email: string, code: string, challengeId: string) {
    return this.sendCode(email, code, challengeId, true);
  }
  private async sendCode(email: string, code: string, challengeId: string, recovery: boolean) {
    const config = emailLoginConfig();
    if (!config.enabled) throw new ServiceUnavailableException('Email login is not configured');
    if (config.devOnly) return;
    try {
      const purpose = recovery ? 'customer-password-recovery' : 'customer-login';
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${process.env.AUTH_EMAIL_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `${purpose}/${challengeId}` }, body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM!.trim(), to: [email],
        subject: recovery ? 'Massajoy password recovery code' : 'Massajoy sign-in code',
        text: recovery ? `Your Massajoy password recovery code is ${code}. Use it only to set a new password. It expires in 10 minutes. If you did not request password recovery, ignore this email.`
          : `Your Massajoy sign-in code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.` }) });
      if (!response.ok) throw new Error();
    } catch { throw new ServiceUnavailableException('Email delivery is temporarily unavailable'); }
  }
}
