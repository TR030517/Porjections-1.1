import { createRequire } from 'node:module';
import { passwordPolicy, passwordPolicyError, validRolePassword } from './password-policy';
import { requireRolePassword } from './validated-password';
import { BadRequestException } from '@nestjs/common';

const bootstrapPolicy = createRequire(__filename)('../../scripts/lib/password-policy.cjs') as {
  validRolePassword(value: unknown, role: string): boolean;
};

describe('one role policy across API, web and pre-build bootstrap', () => {
  test.each(['ADMIN', 'STAFF'])('%s rejects each 6–11 byte value and accepts 12 and 72 bytes', role => {
    for (let bytes = 6; bytes < 12; bytes++) {
      expect(() => requireRolePassword('a'.repeat(bytes), role)).toThrow(BadRequestException);
      expect(passwordPolicyError('a'.repeat(bytes), role)).toContain('12–72');
    }
    expect(requireRolePassword('a'.repeat(12), role)).toHaveLength(12);
    expect(requireRolePassword('a'.repeat(72), role)).toHaveLength(72);
  });

  test('merchant and customer retain six-byte minima, staff retains twelve', () => {
    for (const role of ['MERCHANT', 'CUSTOMER']) {
      expect(passwordPolicy(role)).toEqual({ minimumUtf8Bytes: 6, maximumUtf8Bytes: 72 });
      expect(requireRolePassword('123456', role)).toBe('123456');
      expect(validRolePassword('12345', role)).toBe(false);
      expect(requireRolePassword('密密', role)).toBe('密密');
    }
    expect(validRolePassword('123456', 'STAFF')).toBe(false);
    expect(validRolePassword('a'.repeat(20), '__proto__')).toBe(false);
  });

  test('bootstrap and TypeScript policy agree at ASCII, CJK, astral and forbidden-byte boundaries', () => {
    const values: unknown[] = [undefined, null, 12, '', ...Array.from({ length: 6 }, (_, n) => 'a'.repeat(n + 6)),
      'a'.repeat(12), 'a'.repeat(72), 'a'.repeat(73), '密'.repeat(3), '密'.repeat(4), '密'.repeat(24), '密'.repeat(25),
      '😀'.repeat(3), '😀'.repeat(18), '😀'.repeat(19), 'a'.repeat(11) + '\0', 'a'.repeat(11) + '\n', 'a'.repeat(11) + '\r', ' abcdefghij '];
    for (const role of ['ADMIN', 'MERCHANT', 'STAFF', 'CUSTOMER', 'UNKNOWN']) for (const value of values) {
      expect(bootstrapPolicy.validRolePassword(value, role)).toBe(validRolePassword(value, role));
    }
    expect(requireRolePassword('密'.repeat(4), 'ADMIN')).toHaveLength(4);
    expect(requireRolePassword('😀'.repeat(3), 'ADMIN')).toHaveLength(6);
    expect(validRolePassword('密'.repeat(24) + 'a', 'ADMIN')).toBe(false);
    expect(requireRolePassword(' abcdefghij ', 'ADMIN')).toBe(' abcdefghij ');
  });
});
