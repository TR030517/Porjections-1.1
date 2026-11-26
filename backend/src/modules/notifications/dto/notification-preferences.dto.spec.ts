import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PreferenceDto } from './notification.dto';

// Match main.ts: boolean consent must survive the real implicit-conversion boundary.
const transform = (body: unknown) => new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
}).transform(body, { type: 'body', metatype: PreferenceDto });

describe('notification preference request validation', () => {
  test.each([true, false])('preserves explicit JSON boolean consent %j', async pushEnabled => {
    const result = await transform({ pushEnabled });
    expect(result).toBeInstanceOf(PreferenceDto);
    expect(result.pushEnabled).toBe(pushEnabled);
  });

  test.each([
    'false', 'true', 'invalid', '', 0, 1,
    [], [false], ['false'], {}, { enabled: true }, null, undefined,
  ])('rejects non-boolean consent %j before it can reach the service', async pushEnabled => {
    await expect(transform({ pushEnabled })).rejects.toBeInstanceOf(BadRequestException);
  });

  test('rejects a missing consent field', async () => {
    await expect(transform({})).rejects.toBeInstanceOf(BadRequestException);
  });

  test('keeps the whitelist boundary even with a valid consent value', async () => {
    await expect(transform({ pushEnabled: false, userId: 'another-user' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
