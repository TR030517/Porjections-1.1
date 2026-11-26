import { Controller, Post, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FavoritesService } from './favorites.service';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Favorites')
@Controller('favorites')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('CUSTOMER')
@ApiBearerAuth()
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post(':shopId/toggle')
  @ApiOperation({ summary: 'Toggle favorite (add/remove) for a shop' })
  async toggle(@GetUser('id') userId: string, @Param('shopId') shopId: string) {
    return this.favoritesService.toggle(userId, shopId);
  }

  @Get()
  @ApiOperation({ summary: 'List all favorited shop IDs for current user' })
  async listIds(@GetUser('id') userId: string) {
    const ids = await this.favoritesService.listIds(userId);
    return { ids };
  }

  @Get('shops')
  @ApiOperation({ summary: 'List favorited shops with details' })
  async listShops(@GetUser('id') userId: string) {
    return this.favoritesService.listShops(userId);
  }

  @Get(':shopId/check')
  @ApiOperation({ summary: 'Check if a shop is favorited' })
  async check(@GetUser('id') userId: string, @Param('shopId') shopId: string) {
    const favorited = await this.favoritesService.isFavorited(userId, shopId);
    return { favorited };
  }
}
