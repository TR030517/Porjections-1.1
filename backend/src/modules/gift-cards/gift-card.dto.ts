import { Allow } from 'class-validator';

// Keep original wire types: domain validation rejects coerced IDs, booleans or
// numeric strings, while ValidationPipe rejects every non-whitelisted field.
export class GiftPageQueryDto {
  @Allow() page?: unknown;
  @Allow() pageSize?: unknown;
}
export class GiftProductQueryDto extends GiftPageQueryDto { @Allow() shopId?: unknown; }
export class GiftListQueryDto extends GiftPageQueryDto {
  @Allow() status?: unknown;
}
export class GiftAdminQueryDto extends GiftListQueryDto {
  @Allow() userId?: unknown;
  @Allow() entitlementId?: unknown;
}
export class GiftRedemptionQueryDto extends GiftPageQueryDto {
  @Allow() userId?: unknown;
  @Allow() entitlementId?: unknown;
}
export class CreateGiftOrderDto {
  @Allow() productId: unknown;
  @Allow() requestKey: unknown;
  @Allow() paymentMethod?: unknown;
}
export class GiftSalesPolicyDto { @Allow() payAtStoreEnabled: unknown; }
export class GiftSaleEntryDto {
  @Allow() amountCents: unknown;
  @Allow() method: unknown;
  @Allow() reference?: unknown;
  @Allow() reason: unknown;
  @Allow() requestKey: unknown;
}
export class GrantGiftDto {
  @Allow() productId: unknown;
  @Allow() userId: unknown;
  @Allow() reason: unknown;
  @Allow() requestKey: unknown;
}
export class CreateGiftCredentialDto { @Allow() usedUses: unknown; }
export class RedeemGiftDto {
  @Allow() token: unknown;
  @Allow() usedUses: unknown;
  @Allow() requestKey: unknown;
}
export class VoidGiftDto { @Allow() reason: unknown; }
export class EmptyGiftDto {}
