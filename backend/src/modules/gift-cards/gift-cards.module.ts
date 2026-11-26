import { Module } from '@nestjs/common';
import { GiftCardAdminController, GiftCardPublicController, GiftCardsController } from './gift-cards.controller';
import { GiftCardsService } from './gift-cards.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({ controllers: [GiftCardPublicController, GiftCardsController, GiftCardAdminController], providers: [GiftCardsService, RolesGuard], exports: [GiftCardsService] })
export class GiftCardsModule {}
