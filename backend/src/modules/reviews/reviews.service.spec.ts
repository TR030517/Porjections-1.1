import { BadRequestException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

function fixture() {
  const shop: any = { id: 7n, status: 'APPROVED', deletedAt: null, studioProfile: { features: { reviews: false } } };
  const booking: any = { id: 42n, shopId: 7n, userId: 41n, status: 'COMPLETED', deletedAt: null };
  const review: any = {
    id: 10n, bookingId: 42n, shopId: 7n, userId: 41n, isPublic: true,
    rating: 5, content: 'Synthetic historical review', images: [],
    createdAt: new Date('2031-01-15T15:00:00Z'), user: { name: 'Synthetic customer', avatarUrl: null },
  };
  const db: any = {
    $queryRaw: jest.fn(async (query: any) => query.sql.includes("s.status = 'APPROVED'")
      ? shop.status === 'APPROVED' && !shop.deletedAt ? [{ id: shop.id }] : []
      : [{ id: shop.id }]),
    shop: {
      findUnique: jest.fn(async () => shop), findFirst: jest.fn(async () => shop),
      update: jest.fn(async () => shop),
    },
    booking: { findFirst: jest.fn(async ({ where }: any) => where.id === booking.id && where.userId === booking.userId && !booking.deletedAt ? booking : null) },
    review: {
      findFirst: jest.fn(async ({ where }: any) => where.id === review.id && where.userId === review.userId ? review : null),
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => [review]), count: jest.fn(async () => 11),
      create: jest.fn(async ({ data }: any) => ({ ...review, ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...review, ...data })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
      aggregate: jest.fn(async () => ({ _avg: { rating: null }, _count: { id: 0 } })),
    },
  };
  db.$transaction = jest.fn(async (work: any) => typeof work === 'function' ? work(db) : Promise.all(work));
  return { service: new ReviewsService(db), db, shop, booking, review };
}

describe('review availability and ownership boundaries', () => {
  test('closing new reviews keeps existing public history readable and paginated', async () => {
    const f = fixture();
    const result = await f.service.listByShop('7', 2, 10);
    expect(result.items).toEqual([{
      id: 10n, rating: 5, content: 'Synthetic historical review', images: [],
      createdAt: f.review.createdAt, user: { name: 'Synthetic customer', avatarUrl: null },
    }]);
    expect(result.pagination).toEqual({ page: 2, limit: 10, total: 11, totalPages: 2 });
    expect(f.db.review.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { shopId: 7n, isPublic: true }, skip: 10, take: 10, orderBy: { createdAt: 'desc' },
    }));
    expect(f.db.review.count).toHaveBeenCalledWith({ where: { shopId: 7n, isPublic: true } });
    expect(result.items[0]).not.toHaveProperty('userId');
    expect(f.db.review.create).not.toHaveBeenCalled();
  });

  test.each(['SUSPENDED', 'DELETED'])('history remains unavailable for a %s shop', async status => {
    const f = fixture();
    if (status === 'DELETED') f.shop.deletedAt = new Date();
    else f.shop.status = status;
    await expect(f.service.listByShop('7', 1, 10)).rejects.toThrow('Shop not found');
    expect(f.db.review.findMany).not.toHaveBeenCalled();
  });

  test('a closed review feature rejects a completed booking review without any write', async () => {
    const f = fixture();
    const error = await f.service.create('41', { bookingId: '42', rating: 5 }).catch(error => error);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({ code: 'REVIEWS_DISABLED', message: 'Reviews are disabled for this shop' });
    expect(f.db.booking.findFirst).toHaveBeenCalledWith({ where: { id: 42n, userId: 41n, deletedAt: null } });
    expect(f.db.$queryRaw.mock.calls[0][0].sql).toContain('FOR UPDATE');
    expect(f.db.review.create).not.toHaveBeenCalled();
    expect(f.db.review.aggregate).not.toHaveBeenCalled();
    expect(f.db.shop.update).not.toHaveBeenCalled();
  });

  test('a closed review feature also rejects editing an existing review', async () => {
    const f = fixture();
    const error = await f.service.update('41', '10', { rating: 4 }).catch(error => error);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({ code: 'REVIEWS_DISABLED', message: 'Reviews are disabled for this shop' });
    expect(f.db.review.update).not.toHaveBeenCalled();
    expect(f.db.review.aggregate).not.toHaveBeenCalled();
    expect(f.db.shop.update).not.toHaveBeenCalled();
  });

  test('the author may remove a review after both review closure and shop suspension', async () => {
    const f = fixture();
    f.shop.status = 'SUSPENDED';
    await expect(f.service.delete('41', '10')).resolves.toEqual({ message: 'Review deleted successfully' });
    expect(f.db.review.deleteMany).toHaveBeenCalledWith({ where: { id: 10n, userId: 41n } });
    expect(f.db.review.aggregate).toHaveBeenCalledWith({ where: { shopId: 7n, isPublic: true }, _avg: { rating: true }, _count: { id: true } });
    expect(f.db.shop.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { avgRating: 0, reviewCount: 0 } });
  });

  test.each(['update', 'delete'] as const)('another customer cannot %s a review', async action => {
    const f = fixture();
    await expect(action === 'update' ? f.service.update('99', '10', { rating: 1 }) : f.service.delete('99', '10')).rejects.toThrow('Review not found');
    expect(f.db.review.update).not.toHaveBeenCalled();
    expect(f.db.review.deleteMany).not.toHaveBeenCalled();
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });

  test('creating a review requires an owned completed, non-deleted booking', async () => {
    const f = fixture();
    await expect(f.service.create('99', { bookingId: '42', rating: 5 })).rejects.toThrow('Booking not found');
    f.booking.status = 'CONFIRMED';
    await expect(f.service.create('41', { bookingId: '42', rating: 5 })).rejects.toThrow('Can only review completed bookings');
    f.booking.status = 'COMPLETED';
    f.booking.deletedAt = new Date();
    await expect(f.service.create('41', { bookingId: '42', rating: 5 })).rejects.toThrow('Booking not found');
    expect(f.db.review.create).not.toHaveBeenCalled();
  });

  test('reopening reviews permits a completed booking review and an owned update', async () => {
    const f = fixture();
    f.shop.studioProfile.features.reviews = true;
    await expect(f.service.create('41', { bookingId: '42', rating: 5 })).resolves.toMatchObject({ userId: 41n, shopId: 7n, bookingId: 42n, rating: 5 });
    await expect(f.service.update('41', '10', { rating: 4, content: 'Synthetic update' })).resolves.toMatchObject({ rating: 4, content: 'Synthetic update' });
    expect(f.db.review.create).toHaveBeenCalledTimes(1);
    expect(f.db.review.update).toHaveBeenCalledTimes(1);
  });
});
