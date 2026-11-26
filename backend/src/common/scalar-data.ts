import { BadRequestException } from '@nestjs/common';

/** Never pass an untrusted object to Prisma's nested-write API. */
export function scalarData(input: unknown, allowed: readonly string[]): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Expected an object');
  }
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key) || (value !== null && typeof value === 'object')) {
      throw new BadRequestException(`Unsupported field: ${key}`);
    }
    if (value !== undefined) output[key] = value;
  }
  return output;
}
