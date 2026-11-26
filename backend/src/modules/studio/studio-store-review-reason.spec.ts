import { StudioService } from './studio.service';

function fixture() {
  const previous = {
    id: 7n,
    ownerId: 2n,
    name: 'Synthetic studio',
    shortName: 'synthetic-studio',
    status: 'REJECTED',
    reviewComment: 'Old rejection reason',
    reviewedAt: new Date('2026-11-20T12:00:00.000Z'),
    reviewedBy: 3n,
    timezone: 'America/Los_Angeles',
    phone: '+12025550149',
    address: 'Synthetic address',
    city: 'Seattle',
    state: 'Washington',
    zipCode: '98144',
    description: '',
    latitude: 47.6,
    longitude: -122.3,
    category: 'MIXED',
    businessHours: { monday: { open: '09:00', close: '18:00', closed: false } },
    studioProfile: {},
  };
  const db = {
    user: { findFirst: jest.fn(async () => ({ id: 2n, role: 'MERCHANT', status: 'ACTIVE', deletedAt: null })) },
    shopLoginBinding: { findUnique: jest.fn(async () => null) },
    shopImage: { findMany: jest.fn(async () => []) },
  };
  return { service: new StudioService({} as any), db, previous };
}

describe('studio store rejection reason updates', () => {
  test('an admin can update the reason while the shop remains rejected', async () => {
    const f = fixture();
    const saved = await (f.service as any).data(
      f.db,
      'stores',
      { status: 'REJECTED', reviewReason: '  Updated address evidence is required  ' },
      f.previous,
      { id: '11', role: 'ADMIN' },
    );

    expect(saved).toMatchObject({
      status: 'REJECTED',
      reviewComment: 'Updated address evidence is required',
      reviewedBy: 11n,
    });
    expect(saved.reviewedAt).toBeInstanceOf(Date);
    expect(saved.reviewedAt).not.toEqual(f.previous.reviewedAt);
  });

  test('resubmitting the same rejection reason does not rewrite review metadata', async () => {
    const f = fixture();
    const saved = await (f.service as any).data(
      f.db,
      'stores',
      { status: 'REJECTED', reviewReason: f.previous.reviewComment },
      f.previous,
      { id: '11', role: 'ADMIN' },
    );

    expect(saved).not.toHaveProperty('reviewComment');
    expect(saved).not.toHaveProperty('reviewedAt');
    expect(saved).not.toHaveProperty('reviewedBy');
  });
});
