/**
 * MJAPP — Users Controller
 */
import { Controller, Get, Patch, Body, Param, UseGuards, ForbiddenException, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/user.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user by ID' })
  async getUser(@Param('id') id: string, @Req() req: any) {
    if (req.user.id !== id && req.user.role !== 'ADMIN') throw new ForbiddenException();
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile' })
  async updateProfile(
    @Param('id') id: string,
    @Body() data: UpdateUserDto,
    @Req() req: any,
  ) {
    if (req.user.id !== id) throw new ForbiddenException('Only your own profile can be changed here');
    return this.usersService.updateProfile(id, data);
  }
}
