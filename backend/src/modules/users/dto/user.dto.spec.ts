import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateUserDto } from './user.dto';

const transform = (body: unknown) => new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
}).transform(body, { type: 'body', metatype: UpdateUserDto });

describe('UpdateUserDto raw JSON validation', () => {
  test.each([false, 123, {}, [], null])('rejects a non-string name %j before implicit conversion', async name => {
    await expect(transform({ name })).rejects.toBeInstanceOf(BadRequestException);
  });

  test.each([false, 123, {}, [], null])('rejects a non-string email %j before implicit conversion', async email => {
    await expect(transform({ email })).rejects.toBeInstanceOf(BadRequestException);
  });

  test('trims names and normalizes email strings', async () => {
    await expect(transform({ name: '  Alex Doe  ', email: '  USER@example.com  ' })).resolves.toMatchObject({
      name: 'Alex Doe',
      email: 'user@example.com',
    });
  });

  test('allows omitted fields so an unchanged profile is not rewritten', async () => {
    await expect(transform({})).resolves.toBeInstanceOf(UpdateUserDto);
  });
});
