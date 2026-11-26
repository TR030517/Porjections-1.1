import { StudioService } from './studio.service';

const admin = { id: '1', role: 'ADMIN' };
const merchant = { id: '2', role: 'MERCHANT' };

function fixture() {
  const rows: any[] = [
    { id: 1n, shopId: 11n, orderNo: 'GIFT-WEST', status: 'PAID', productTitleSnapshot: 'Historical west gift', product: { title: 'Renamed west gift' }, shop: { ownerId: 2n, timezone: 'America/Los_Angeles', privateContact: 'not public' }, providerPaymentId: 'private-provider', requestKey: 'private-key', requestHash: 'private-hash', createdAt: new Date('2035-01-01T12:00:00Z') },
    { id: 2n, shopId: 12n, orderNo: 'GIFT-EAST', status: 'PAID', productTitleSnapshot: null, product: { title: 'East gift' }, shop: { ownerId: 2n, timezone: 'America/New_York' }, providerPaymentId: null, requestKey: 'private-key-2', requestHash: 'private-hash-2' },
    { id: 3n, shopId: 13n, orderNo: 'GIFT-OTHER', status: 'PENDING', product: { title: 'Other gift' }, shop: { ownerId: 3n, timezone: 'Pacific/Honolulu' } },
  ];
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'AND') return value.every((part: any) => matches(row, part));
    if (value && typeof value === 'object') {
      if ('contains' in value) return typeof row?.[key] === 'string' && row[key].includes(value.contains);
      return row?.[key] != null && matches(row[key], value);
    }
    return row?.[key] === value;
  });
  const findMany = jest.fn(async ({ where, skip, take, include }: any) => rows.filter(row => matches(row, where)).sort((a, b) => Number(b.id - a.id)).slice(skip, skip + take).map(row => ({ ...row,
    // Honor Prisma's relation select so the test detects a missing timezone include.
    shop: include?.shop?.select?.timezone ? { timezone: row.shop?.timezone } : undefined,
    product: include?.product?.select?.title ? row.product : undefined,
  })));
  const count = jest.fn(async ({ where }: any) => rows.filter(row => matches(row, where)).length);
  return { rows, findMany, count, service: new StudioService({ giftCardOrder: { findMany, count } } as any) };
}

describe('studio gift order store timezones', () => {
  test('a cross-store list uses each order store zone, minimal relation selects and historical product snapshots', async () => {
    const f = fixture(), result = await f.service.list('gift-card-orders', {}, admin);
    expect(result.items.map((row: any) => [row.id, row.timezone])).toEqual([
      ['3', 'Pacific/Honolulu'], ['2', 'America/New_York'], ['1', 'America/Los_Angeles'],
    ]);
    expect(result.items.find((row: any) => row.id === '1').productName).toBe('Historical west gift');
    expect(result.items.find((row: any) => row.id === '2').productName).toBe('East gift');
    expect(f.findMany.mock.calls[0][0].include).toEqual({ product: { select: { title: true } }, shop: { select: { timezone: true } } });
    const selected = await f.service.list('gift-card-orders', { shopId: '12' }, admin);
    expect(selected.items.map((row: any) => row.timezone)).toEqual(['America/New_York']);
  });

  test('missing or invalid store zones remain unknown and never inherit another store or the host zone', async () => {
    const f = fixture();
    f.rows[0].shop.timezone = null;
    f.rows[1].shop.timezone = 'Invalid/Timezone';
    f.rows[2].shop.timezone = ' America/New_York ';
    const result = await f.service.list('gift-card-orders', {}, admin);
    expect(result.items.map((row: any) => row.timezone)).toEqual([null, null, null]);
  });

  test('owner, selected shop, order search, status and pagination restrictions remain intersected', async () => {
    const f = fixture(), own = await f.service.list('gift-card-orders', {}, merchant);
    expect(own.items.map((row: any) => row.id)).toEqual(['2', '1']);
    const query = { shopId: '12', status: 'PAID', search: 'EAST', page: '1', pageSize: '1' };
    const result = await f.service.list('gift-card-orders', query, merchant);
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(result.items.map((row: any) => row.id)).toEqual(['2']);
    const where = { shop: { ownerId: 2n }, shopId: 12n, AND: [{ status: 'PAID' }], orderNo: { contains: 'EAST' } };
    expect(f.findMany.mock.calls[1][0]).toMatchObject({ where, skip: 0, take: 1, orderBy: { id: 'desc' } });
    expect(f.count).toHaveBeenLastCalledWith({ where });
    const other = await f.service.list('gift-card-orders', { shopId: '13' }, merchant);
    expect(other).toMatchObject({ items: [], total: 0 });
  });

  test('mapping exposes no nested store or provider and request secrets, without mutating source records', async () => {
    const f = fixture(), before = structuredClone(f.rows), result = await f.service.list('gift-card-orders', {}, admin);
    for (const row of result.items) {
      for (const key of ['shop', 'providerPaymentId', 'requestKey', 'requestHash']) expect(row).not.toHaveProperty(key);
    }
    expect(JSON.stringify(result)).not.toMatch(/private-provider|private-key|private-hash|privateContact/);
    expect(f.rows).toEqual(before);
    expect(result.items.find((row: any) => row.id === '1').createdAt).toBe('2035-01-01T12:00:00.000Z');
  });
});
