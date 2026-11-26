/**
 * MJAPP — Reviews Module
 * Customer reviews: create, list by shop, list by user
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [PrismaModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, RolesGuard],
  exports: [ReviewsService],
})
export class ReviewsModule {}
