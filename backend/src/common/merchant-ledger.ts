import { Prisma } from '@prisma/client';

/** Internal bookkeeping only. No provider account, authorization or payout is created. */
export async function createShopLedger(tx: Prisma.TransactionClient, shop: { id: bigint; ownerId: bigint }, operatorId: bigint) {
  const profile = await tx.merchantProfile.create({ data: { userId: shop.ownerId, shopId: shop.id, balanceCents: 0, pendingCents: 0, totalEarnedCents: 0 } });
  await tx.auditLog.create({ data: { action: 'PROFILE_CREATE', targetType: 'merchant_profiles', targetId: profile.id, operatorId,
    detail: { shopId: shop.id.toString(), internalZeroBalance: true, externalPaymentsEnabled: false } } });
  return profile;
}
