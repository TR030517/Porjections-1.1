import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateVariantDto, UpdateVariantDto } from './reservation.dto';

const transform = (metatype: any, body: unknown) => new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
}).transform(body, { type: 'body', metatype });

const createVariant = { serviceId: '1', name: '30 min', durationMin: 30, priceCents: 4000 };

describe('variant isActive raw JSON validation', () => {
  test.each([true, false])('preserves the boolean value %j on create and update', async isActive => {
    await expect(transform(CreateVariantDto, { ...createVariant, isActive })).resolves.toMatchObject({ isActive });
    await expect(transform(UpdateVariantDto, { isActive })).resolves.toMatchObject({ isActive });
  });

  test.each(['true', 'false', 0, 1, {}, [], null])('rejects non-boolean create values %j', async isActive => {
    await expect(transform(CreateVariantDto, { ...createVariant, isActive })).rejects.toBeInstanceOf(BadRequestException);
  });

  test.each(['true', 'false', 0, 1, {}, [], null])('rejects non-boolean update values %j', async isActive => {
    await expect(transform(UpdateVariantDto, { isActive })).rejects.toBeInstanceOf(BadRequestException);
  });

  test('allows omission so an existing enabled state remains unchanged', async () => {
    await expect(transform(UpdateVariantDto, {})).resolves.toBeInstanceOf(UpdateVariantDto);
  });
});
