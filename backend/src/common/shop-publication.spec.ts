import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireShopPublication, shopPublication } from './shop-publication';

// Synthetic publishing inputs only. No repository or provider is used.
const readyShop = () => ({
  name: 'Synthetic studio', shortName: 'synthetic-studio', timezone: 'America/New_York',
  phone: '+12025550149', address: 'Synthetic address', city: 'Synthetic city', state: 'Synthetic state',
  latitude: new Prisma.Decimal('40.7'), longitude: new Prisma.Decimal('-73.9'),
  businessHours: { monday: { open: '09:00', close: '18:00', closed: false } },
  owner: { role: 'MERCHANT', status: 'ACTIVE', deletedAt: null },
  loginBinding: { userId: 20n, user: { id:20n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null, loginName:'synthetic-merchant', email:null, phone:null, passwordHash:'$2b$12$'+'A'.repeat(53) } },
});

function expectBlocked(shop: any, missingKey: string) {
  expect(shopPublication(shop).publicationReady).toBe(false);
  try {
    requireShopPublication(shop);
    throw new Error('Expected publishing to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({ missingFields: expect.arrayContaining([missingKey]) });
  }
}

describe('Shared shop publication policy', () => {
  test('a complete merchant-owned shop accepts real Decimal coordinates and a valid IANA zone', () => {
    expect(shopPublication(readyShop()).publicationReady).toBe(true);
    expect(() => requireShopPublication(readyShop())).not.toThrow();
  });
  test.each([undefined, null, '', ' ', 'Not/A_Timezone'])('missing or invalid timezone %# blocks publishing', timezone => {
    expectBlocked({ ...readyShop(), timezone }, 'timezone');
  });
  test.each([
    null,
    { role: 'USER', status: 'ACTIVE', deletedAt: null },
    { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
    { role: 'MERCHANT', status: 'SUSPENDED', deletedAt: null },
    { role: 'MERCHANT', status: 'ACTIVE', deletedAt: new Date('2026-10-27T00:00:00Z') },
  ])('independent login state %# does not control public shop publication', user => {
    const shop={ ...readyShop(), loginBinding: user ? { userId: 20n, user } : null };
    expect(shopPublication(shop).publicationReady).toBe(true);
    expect(()=>requireShopPublication(shop)).not.toThrow();
  });
  test.each([{passwordHash:null},{passwordHash:'not-bcrypt'},{loginName:'bad/path'}])('an unroutable account does not hide a published store %#', patch => {
    const user = {...readyShop().loginBinding.user,...patch};
    expect(shopPublication({...readyShop(),loginBinding:{userId:20n,user}}).publicationReady).toBe(true);
  });
  test('publication excludes login readiness even when the account service reports false', () => {
    const result=shopPublication(readyShop(),undefined,false);
    expect(result.publicationReady).toBe(true);
    expect(result.publicationChecklist.some(item=>item.key==='loginAccount')).toBe(false);
  });
  test.each([
    { latitude: undefined }, { longitude: undefined },
    { latitude: null }, { longitude: null },
    { latitude: '' }, { longitude: ' ' },
    { latitude: true }, { longitude: false },
    { latitude: NaN }, { longitude: Infinity },
    { latitude: 90.01 }, { latitude: -90.01 }, { longitude: 180.01 }, { longitude: -180.01 },
    { latitude: 0, longitude: 0 },
  ])('coordinates are not an operator-supplied publication requirement %#', patch => {
    const result = shopPublication({ ...readyShop(), ...patch });
    expect(result.publicationReady).toBe(true); expect(result.publicationChecklist.some(check => check.key === 'coordinates')).toBe(false);
  });
  test('valid coordinates on the equator or prime meridian remain publishable', () => {
    expect(shopPublication({ ...readyShop(), latitude: 0, longitude: -73 }).publicationReady).toBe(true);
    expect(shopPublication({ ...readyShop(), latitude: 40, longitude: 0 }).publicationReady).toBe(true);
  });
  test.each([
    null, [], {}, { monday: { closed: true } },
    { monday: { open: '25:00', close: '26:00', closed: false } },
    { monday: { open: '09:60', close: '18:00', closed: false } },
    { monday: { open: '9:00', close: '18:00', closed: false } },
    { monday: { open: '18:00', close: '09:00', closed: false } },
    { monday: { open: '09:00', close: '09:00', closed: false } },
    { monday: { open: '09:00', close: '18:00', closed: false }, tuesday: { open: '25:00', close: '26:00', closed: false } },
    { monday: { open: '09:00', close: '18:00', closed: false }, tuesday: { open: '18:00', close: '09:00', closed: false } },
  ])('absent or invalid open-day hours %# block publishing', businessHours => {
    expectBlocked({ ...readyShop(), businessHours }, 'hours');
  });
  test.each([
    [{ name: ' ', shortName: '' }, 'name'], [{ phone: ' ' }, 'contact'],
    [{ address: '' }, 'address'], [{ city: ' ' }, 'address'], [{ state: '' }, 'address'],
  ] as const)('checklist reports incomplete ordinary publishing fields %#', (patch, key) => {
    expectBlocked({ ...readyShop(), ...patch }, key);
  });
  test('the historical owner snapshot or status never overrides an active independent login', () => {
    const shop = readyShop();
    expect(shopPublication(shop, { role: 'MERCHANT', status: 'SUSPENDED', deletedAt: null }).publicationReady).toBe(true);
    expect(shopPublication({ ...shop, owner: null }).publicationReady).toBe(true);
    expect(shopPublication({ ...shop, loginBinding: null }).publicationReady).toBe(true);
  });
});
