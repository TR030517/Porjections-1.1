import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { studioStoreSearch } from './query';

describe('Studio store search', () => {
  const originalOrigins = process.env.CORS_ORIGINS;
  const originalNodeEnv = process.env.NODE_ENV;
  const findUnique = jest.fn();
  const db = { shopAlias: { findUnique } } as unknown as Pick<PrismaClient, 'shopAlias'>;
  const noMatch = { id: { in: [] } };
  const exactAlias = (value: string) => ({
    aliases: { some: { kind: 'SHORT_NAME', source: 'massajoy', isActive: true, value } },
  });

  beforeEach(() => {
    process.env.CORS_ORIGINS = 'https://booking.example.test, http://localhost:3800';
    process.env.NODE_ENV = 'production';
    findUnique.mockReset();
  });

  afterEach(() => {
    if (originalOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = originalOrigins;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it.each([
    '/s/AngelFootMassage',
    'https://booking.example.test/s/angelfootmassage',
    'booking.example.test/s/angelfootmassage',
    'localhost:3800/s/angelfootmassage',
    'https://app.asianmassagebook.com/AngelFootMassage',
    'app.asianmassagebook.com/AngelFootMassage',
    'https://booking.example.test/app/#/s/angelfootmassage',
    '/storedetails?id=1320#/s/angelfootmassage',
  ])('resolves the active exact alias from %s', async (input) => {
    await expect(studioStoreSearch(input, db)).resolves.toEqual(exactAlias('angelfootmassage'));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    'https://other.example.test/s/angelfootmassage',
    'other.example.test/store-1320',
    'https://booking.example.test:8443/s/angelfootmassage',
  ])('shows the operator what to enter for %s', async (input) => {
    await expect(studioStoreSearch(input, db)).rejects.toBeInstanceOf(BadRequestException);
    await expect(studioStoreSearch(input, db)).rejects.toThrow('请粘贴 Massajoy 门店网址，或输入门店名称或短链。');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('accepts the development customer address on a development backend', async () => {
    process.env.NODE_ENV = 'development';
    await expect(studioStoreSearch('127.0.0.1:3004/s/angelfootmassage', db))
      .resolves.toEqual(exactAlias('angelfootmassage'));
  });

  it.each([
    'store-1320',
    '/store-1320',
    '/app/#/pages/shop/shopdetails.html?id=1320',
    'https://app.asianmassagebook.com/h5/#/pages/classificat/storedetails?id=1320',
  ])('uses the legacy mapping for %s even when a current ID has the same digits', async (input) => {
    findUnique.mockResolvedValueOnce({ isActive: true, shopId: 946n });
    await expect(studioStoreSearch(input, db)).resolves.toEqual({ id: 946n });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique.mock.calls[0][0].where.kind_source_value)
      .toEqual({ kind: 'LEGACY_ID', source: 'massajoy1', value: '1320' });
  });

  it('looks up a current ID directly and keeps bare digits as a name search', async () => {
    await expect(studioStoreSearch('/shops/1320', db)).resolves.toEqual({ id: 1320n });
    await expect(studioStoreSearch('1320', db)).resolves.toEqual(expect.objectContaining({
      OR: expect.arrayContaining([{ name: { contains: '1320' } }]),
    }));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('uses the earlier imported mapping only when the preferred mapping is absent', async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ isActive: true, shopId: 946n });
    await expect(studioStoreSearch('/store-1320', db)).resolves.toEqual({ id: 946n });
    expect(findUnique.mock.calls[1][0].where.kind_source_value)
      .toEqual({ kind: 'LEGACY_STORE_ID', source: 'Massajoy1.0', value: '1320' });

    findUnique.mockClear().mockResolvedValueOnce({ isActive: false, shopId: 946n });
    await expect(studioStoreSearch('/store-1320', db)).resolves.toEqual(noMatch);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/admin/#/s/angelfootmassage',
    '/merchant/#/pages/shop/storedetails?id=1320',
    '/h5/#/pages/shop/storedetails?id=1320&id=3740',
    '/store-floral',
    '/store-01320',
  ])('finds no shop for the non-customer or invalid route %s', async (input) => {
    await expect(studioStoreSearch(input, db)).resolves.toEqual(noMatch);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('resolves a store-prefixed short name from its canonical path', async () => {
    await expect(studioStoreSearch('/s/store-floral', db)).resolves.toEqual(exactAlias('store-floral'));
  });
});
