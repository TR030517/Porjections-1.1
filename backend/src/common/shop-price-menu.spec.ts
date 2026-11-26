import { normalizePriceMenu, PRICE_MENU_LIMITS, PriceMenuValidationError, publicPriceMenu } from './shop-price-menu';
import { publicShopProfile } from './shop-public-profile';
import { shopMediaUrls, validateMediaUrl } from './managed-media';
import { storedStudioProfile } from './shop-studio-profile';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateShopDto } from '../modules/merchant/dto/merchant.dto';
import { priceMenuRevision } from './shop-price-menu-revision';

const asset = '/api/v1/upload/media/11111111-1111-4111-8111-111111111111/file';
const item = () => ({ name: 'Source item', priceText: '$80 / ask in store' });
const menu = () => [{ category: '', items: [item(), { name: 'No public price', priceText: '' }] }];

describe('merchant display-menu DTO with the actual global conversion settings', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
  const convert = (body: unknown): Promise<UpdateShopDto> => pipe.transform(body, { type: 'body', metatype: UpdateShopDto });

  test('keeps object groups and exact nested wording through ValidationPipe before service validation', async () => {
    const input = [{ category: '', items: [{ name: 'Original item', priceText: '$80–$120 / 30mins', description: 'Ask in store\nNo duration inferred', imageUrl: 'https://images.example.invalid/menu.webp' }, { name: 'No price supplied', priceText: '' }] }];
    const expectedPriceMenuRevision = priceMenuRevision(10n, { priceMenu: [] });
    const dto = await convert({ priceMenu: input, expectedPriceMenuRevision });
    expect(dto).toBeInstanceOf(UpdateShopDto);
    expect(Array.isArray(dto.priceMenu)).toBe(true);
    expect(Array.isArray(dto.priceMenu![0])).toBe(false);
    expect(Object.getPrototypeOf(dto.priceMenu![0])).toBe(Object.prototype);
    expect(dto.priceMenu).toEqual(input);
    expect(dto.expectedPriceMenuRevision).toBe(expectedPriceMenuRevision);
    expect(normalizePriceMenu(dto.priceMenu)).toEqual(input);
    expect(normalizePriceMenu((await convert({ priceMenu: [] })).priceMenu)).toEqual([]);
    expect((await convert({ description: 'Introduction only' })).priceMenu).toBeUndefined();
  });

  test.each([
    [[{ category: '', items: [] }]],
    [{ category: '', items: [[item()]] }],
    [{ category: '', items: [item()], sourceSample: 'PRIVATE' }],
    [{ category: '', items: [{ ...item(), durationMin: 60 }] }],
    [{ category: '', items: [{ name: 'No numeric coercion', priceText: 80 }] }],
    [{ category: 1, items: [item()] }],
  ].map(value => [value]))('still rejects nested arrays, unknown fields and non-string source values after conversion %#', async priceMenu => {
    const dto = await convert({ priceMenu });
    expect(() => normalizePriceMenu(dto.priceMenu)).toThrow(PriceMenuValidationError);
  });

  test('rejects top-level private profiles rather than whitelisting them during transformation', async () => {
    await expect(convert({ priceMenu: menu(), studioProfile: { sourceSample: 'PRIVATE' } })).rejects.toThrow(BadRequestException);
  });

  test('keeps a valid revision as metadata and rejects malformed client metadata under real implicit conversion', async () => {
    for (const expectedPriceMenuRevision of ['', 'bad', 'A'.repeat(64), {}, [], 123]) {
      await expect(convert({ priceMenu: menu(), expectedPriceMenuRevision })).rejects.toThrow(BadRequestException);
    }
    await expect(convert({ priceMenu: menu(), priceMenuRevision: 'a'.repeat(64) })).rejects.toThrow(BadRequestException);
  });
});

describe('display-only price menu validation and public boundary', () => {
  test('keeps source price wording and missing category/price without inventing currency, duration or service IDs', () => {
    const input = [{ category: ' Original group ', items: [{ name: ' Massage ', priceText: ' $80–$120 / couple? ', description: 'Line one\r\nLine two', imageUrl: 'https://images.example.invalid/menu.webp' }] }];
    expect(normalizePriceMenu(input)).toEqual([{ category: 'Original group', items: [{ name: 'Massage', priceText: '$80–$120 / couple?', description: 'Line one\nLine two', imageUrl: 'https://images.example.invalid/menu.webp' }] }]);
    expect(normalizePriceMenu(menu())).toEqual(menu());
    expect(JSON.stringify(normalizePriceMenu(input))).not.toMatch(/priceCents|durationMin|currency|serviceId/);
    expect(normalizePriceMenu([])).toEqual([]);
  });

  test.each([
    null, {}, [{ category: '', items: [null] }], [{ category: '', items: [{ name: '', priceText: '' }] }],
    [{ category: '', items: [{ name: 'Name', priceText: 80 }] }], [{ category: 1, items: [] }],
    [{ category: '', items: [{ ...item(), durationMin: 60 }] }], [{ category: '', items: [], sourceSample: 'private' }],
    [{ category: '', items: [{ ...item(), description: null }] }], [{ category: '', items: [{ ...item(), imageUrl: null }] }],
    [{ category: '', items: [{ ...item(), name: '<script>alert(1)</script>' }] }],
    [{ category: '', items: [{ ...item(), priceText: '80\u0000USD' }] }],
  ].map(value => [value]))('rejects malformed shape, hidden fields, HTML, controls and coerced source money %#', value => {
    expect(() => normalizePriceMenu(value)).toThrow(PriceMenuValidationError);
  });

  test('enforces total groups/items, text lengths and UTF-8 budget before any write', () => {
    expect(normalizePriceMenu(Array.from({ length: 100 }, () => ({ category: '', items: Array.from({ length: 10 }, item) })))).toHaveLength(100);
    expect(() => normalizePriceMenu(Array.from({ length: 101 }, () => ({ category: '', items: [] })))).toThrow(PriceMenuValidationError);
    expect(() => normalizePriceMenu([{ category: '', items: Array.from({ length: 1001 }, item) }])).toThrow(PriceMenuValidationError);
    for (const field of ['name','priceText','description'] as const) {
      expect(() => normalizePriceMenu([{ category: '', items: [{ ...item(), [field]: 'x'.repeat(PRICE_MENU_LIMITS[field] + 1) }] }])).toThrow(PriceMenuValidationError);
    }
    const unicode = [{ category: '', items: Array.from({ length: 200 }, () => ({ ...item(), description: '中'.repeat(2000) })) }];
    expect(() => normalizePriceMenu(unicode)).toThrow(/768 KiB/);
  });

  test('allows exact managed paths and HTTPS only, and never exposes private nested data', () => {
    const projected = publicPriceMenu([{ category: '', sourceSample: 'PRIVATE_SOURCE', items: [
      { ...item(), imageUrl: asset, secret: 'PRIVATE_SECRET' },
      { name: 'External', priceText: '', imageUrl: 'https://images.example.invalid/public.webp', rawText: 'PRIVATE_RAW' },
      { name: 'Unsafe image', priceText: '', imageUrl: 'javascript:alert(1)' },
      { name: '<img src=x onerror=alert(1)>', priceText: '' },
    ] }]);
    expect(projected[0].items).toEqual([{ ...item(), imageUrl: asset }, { name: 'External', priceText: '', imageUrl: 'https://images.example.invalid/public.webp' }, { name: 'Unsafe image', priceText: '' }]);
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|secret|rawText|sourceSample|javascript|onerror/);
    for (const imageUrl of ['http://images.example.invalid/a.webp', 'data:image/png;base64,AA==', '//images.example.invalid/a.webp', 'https://user:pass@images.example.invalid/a.webp', '/api/v1/upload/media/other/file']) {
      expect(() => normalizePriceMenu([{ category: '', items: [{ ...item(), imageUrl }] }])).toThrow(PriceMenuValidationError);
    }
  });

  test('detail explicitly projects menu while summaries skip the large catalog and private source remains private', () => {
    const shop = { studioProfile: { priceMenu: menu(), sourceSample: { private: 'PRIVATE' } } };
    expect(publicShopProfile(shop).priceMenu).toEqual(menu());
    expect(publicShopProfile(shop, [], { includePriceMenu: false })).not.toHaveProperty('priceMenu');
    expect(publicShopProfile(shop)).not.toHaveProperty('sourceSample');
  });

  test('static subjects roundtrip only through menus and are excluded from shop-owned upload references', () => {
    const imageUrl = '/service-gallery/v1/body-massage.webp';
    const value = [{ category: 'Body', items: [{ name: 'My wording', priceText: 'Ask in store', imageUrl }] }];
    expect(normalizePriceMenu(value)).toEqual(value);
    expect(publicPriceMenu(value)).toEqual(value);
    expect(shopMediaUrls({ priceMenu: value, gallery: [asset] })).toEqual([asset]);
    expect(() => validateMediaUrl(imageUrl)).toThrow();
    const projected = publicShopProfile({ studioProfile: { priceMenu: value, logoUrl: imageUrl, bannerUrl: imageUrl, gallery: [imageUrl] } });
    expect(projected.priceMenu).toEqual(value);
    expect(projected.media).toEqual({ logoUrl: null, coverUrl: null, galleryUrls: [], posterUrl: null });
  });

  test('managed media stays referenced when moved from gallery into a menu; clearing menu releases only its last use', () => {
    const profile = { gallery: [asset], priceMenu: [{ category: '', items: [{ ...item(), imageUrl: asset }] }] };
    expect(shopMediaUrls(profile)).toEqual([asset]);
    expect(shopMediaUrls({ ...profile, gallery: [] })).toEqual([asset]);
    expect(shopMediaUrls({ ...profile, gallery: [], priceMenu: [] })).toEqual([]);
  });

  test('stored JSON is retained for safe merges and malformed legacy profiles are never silently replaced', () => {
    const source = { sourceSample: { schemaVersion: 1 }, paymentPolicy: { payAtStoreEnabled: false, unknown: 'PRIVATE' }, priceMenu: menu() };
    expect(storedStudioProfile(JSON.stringify(source))).toEqual(source);
    for (const value of ['{broken', '[]', 'false', [], 1]) expect(() => storedStudioProfile(value)).toThrow(/malformed/);
  });
});
