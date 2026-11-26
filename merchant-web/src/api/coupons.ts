import client from '../api/client';

export interface MerchantCoupon {
  id: string;
  shopId: string;
  title: string;
  description: string | null;
  type: 'FIXED_AMOUNT' | 'PERCENT';
  value: number;
  minSpendCents: number;
  totalQuantity: number;
  claimedCount: number;
  usedCount: number;
  perUserLimit: number;
  configuredPerUserLimit?: number;
  validFrom: string;
  validUntil: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED';
  createdAt: string;
  updatedAt: string;
}

export interface CreateCouponDto {
  title: string;
  description?: string;
  type: 'FIXED_AMOUNT' | 'PERCENT';
  value: number;
  minSpendCents?: number;
  totalQuantity?: number;
  perUserLimit?: number;
  validFrom?: string;
  validUntil?: string | null;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
}

export const merchantCouponsApi = {
  async list(shopId: string) {
    const res = await client.get(`/merchant/shops/${shopId}/coupons`);
    return res.data as MerchantCoupon[];
  },
  async create(shopId: string, dto: CreateCouponDto) {
    const res = await client.post(`/merchant/shops/${shopId}/coupons`, dto);
    return res.data as MerchantCoupon;
  },
  async update(shopId: string, id: string, dto: Partial<CreateCouponDto>) {
    const res = await client.patch(`/merchant/shops/${shopId}/coupons/${id}`, dto);
    return res.data as MerchantCoupon;
  },
  async updateStatus(shopId: string, id: string, status: string) {
    const res = await client.patch(`/merchant/shops/${shopId}/coupons/${id}/status`, { status });
    return res.data as MerchantCoupon;
  },
  async remove(shopId: string, id: string) {
    const res = await client.delete(`/merchant/shops/${shopId}/coupons/${id}`);
    return res.data;
  },
};
