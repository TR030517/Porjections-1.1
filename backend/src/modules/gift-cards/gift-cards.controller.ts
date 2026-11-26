import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateGiftCredentialDto, CreateGiftOrderDto, EmptyGiftDto, GiftAdminQueryDto, GiftListQueryDto, GiftPageQueryDto, GiftProductQueryDto, GiftRedemptionQueryDto, GrantGiftDto, RedeemGiftDto, VoidGiftDto, GiftSalesPolicyDto, GiftSaleEntryDto } from './gift-card.dto';
import { GiftActor } from './gift-card.validation';
import { GiftCardsService } from './gift-cards.service';

@Controller('gift-cards')
export class GiftCardPublicController {
  constructor(private readonly gifts: GiftCardsService) {}
  @Get('config') config() { return this.gifts.config(); }
  @Get('products') products(@Query() query: GiftProductQueryDto) { return this.gifts.products({ ...query }); }
  @Get('products/:id') product(@Param('id') id: string) { return this.gifts.product(id); }
}

@Controller('gift-cards')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('CUSTOMER')
export class GiftCardsController {
  constructor(private readonly gifts: GiftCardsService) {}
  @Get('orders') @Header('Cache-Control', 'no-store')
  orders(@GetUser('id') user: string, @Query() query: GiftListQueryDto) { return this.gifts.orders(user, { ...query }); }
  @Get('orders/:id') @Header('Cache-Control', 'no-store')
  order(@GetUser('id') user: string, @Param('id') id: string) { return this.gifts.order(user, id); }
  @Post('orders') @Throttle({ default: { limit: 10, ttl: 60000 } }) @Header('Cache-Control', 'no-store')
  createOrder(@GetUser() actor: GiftActor, @Body() body: CreateGiftOrderDto) { return this.gifts.createOrder(actor, { ...body }); }
  @Post('orders/:id/cancel') @Header('Cache-Control', 'no-store')
  cancel(@GetUser() actor: GiftActor, @Param('id') id: string, @Body() _body: EmptyGiftDto) { return this.gifts.cancelOrder(actor, id); }
  @Post('orders/:id/checkout') @Header('Cache-Control', 'no-store')
  checkout(@GetUser('id') user: string, @Param('id') id: string, @Body() _body: EmptyGiftDto) { return this.gifts.checkout(user, id); }
  @Get('entitlements') @Header('Cache-Control', 'no-store')
  entitlements(@GetUser('id') user: string, @Query() query: GiftListQueryDto) { return this.gifts.entitlements(user, { ...query }); }
  @Get('entitlements/:id') @Header('Cache-Control', 'no-store')
  entitlement(@GetUser('id') user: string, @Param('id') id: string) { return this.gifts.entitlement(user, id); }
  @Get('entitlements/:id/redemptions') @Header('Cache-Control', 'no-store')
  ownRedemptions(@GetUser('id') user: string, @Param('id') id: string, @Query() query: GiftPageQueryDto) { return this.gifts.ownRedemptions(user, id, { ...query }); }
  @Post('entitlements/:id/credential') @Throttle({ default: { limit: 10, ttl: 60000 } }) @Header('Cache-Control', 'no-store')
  credential(@GetUser() actor: GiftActor, @Param('id') id: string, @Body() body: CreateGiftCredentialDto) { return this.gifts.credential(actor, id, { ...body }); }
}

@Controller('gift-cards/admin/shops/:shopId')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MERCHANT')
export class GiftCardAdminController {
  constructor(private readonly gifts: GiftCardsService) {}
  @Get('sales-policy') @Header('Cache-Control', 'no-store')
  salesPolicy(@GetUser() actor: GiftActor, @Param('shopId') shop: string) { return this.gifts.salesPolicy(actor, shop); }
  @Post('sales-policy') @Header('Cache-Control', 'no-store')
  setSalesPolicy(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Body() body: GiftSalesPolicyDto) { return this.gifts.setSalesPolicy(actor, shop, { ...body }); }
  @Get('orders') @Header('Cache-Control', 'no-store')
  orders(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Query() query: GiftAdminQueryDto) { return this.gifts.adminOrders(actor, shop, { ...query }); }
  @Get('orders/:id') @Header('Cache-Control', 'no-store')
  order(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Param('id') id: string) { return this.gifts.adminOrder(actor, shop, id); }
  @Post('orders/:id/receipts') @Header('Cache-Control', 'no-store')
  receipt(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Param('id') id: string, @Body() body: GiftSaleEntryDto) { return this.gifts.recordReceipt(actor, shop, id, { ...body }); }
  @Post('orders/:id/refunds') @Header('Cache-Control', 'no-store')
  refund(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Param('id') id: string, @Body() body: GiftSaleEntryDto) { return this.gifts.recordRefund(actor, shop, id, { ...body }); }
  @Get('entitlements') @Header('Cache-Control', 'no-store')
  entitlements(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Query() query: GiftAdminQueryDto) { return this.gifts.adminEntitlements(actor, shop, { ...query }); }
  @Get('redemptions') @Header('Cache-Control', 'no-store')
  redemptions(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Query() query: GiftRedemptionQueryDto) { return this.gifts.redemptions(actor, shop, { ...query }); }
  @Post('grants') @Header('Cache-Control', 'no-store')
  grant(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Body() body: GrantGiftDto) { return this.gifts.grant(actor, shop, { ...body }); }
  @Post('redeem') @Throttle({ default: { limit: 20, ttl: 60000 } }) @Header('Cache-Control', 'no-store')
  redeem(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Body() body: RedeemGiftDto) { return this.gifts.redeem(actor, shop, { ...body }); }
  @Post('entitlements/:id/void') @Header('Cache-Control', 'no-store')
  void(@GetUser() actor: GiftActor, @Param('shopId') shop: string, @Param('id') id: string, @Body() body: VoidGiftDto) { return this.gifts.void(actor, shop, id, { ...body }); }
}
