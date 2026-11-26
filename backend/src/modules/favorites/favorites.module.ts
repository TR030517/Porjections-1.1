import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [PrismaModule],
  controllers: [FavoritesController],
  providers: [FavoritesService, RolesGuard],
  exports: [FavoritesService],
})
export class FavoritesModule {}
