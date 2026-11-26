import { BadRequestException } from '@nestjs/common';
import { passwordPolicyError } from './password-policy';

export function requireRolePassword(value: unknown, role: string): string {
  const message = passwordPolicyError(value, role);
  if (message) throw new BadRequestException({ code: 'PASSWORD_POLICY', message });
  return value as string;
}
