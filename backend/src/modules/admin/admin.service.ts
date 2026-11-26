import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}
  // Legacy OTP endpoints must never create a second authentication mechanism.
  async sendOtp(_phone: string): Promise<never> { throw new ServiceUnavailableException('Use /auth/password/login'); }
  async login(_phone: string, _code: string): Promise<never> { throw new ServiceUnavailableException('Use /auth/password/login'); }
  async refreshToken(_token: string): Promise<never> { throw new ServiceUnavailableException('Use /auth/refresh'); }
  async getProfile(userId: string) {
    const id = BigInt(userId);
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phone: true,
        email: true,
        name: true,
        role: true,
        status: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user || user.role !== 'ADMIN') {
      throw new NotFoundException('Admin not found');
    }

    return {
      id: user.id.toString(),
      phone: user.phone,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * List all admin accounts (super admin utility)
   */
  async listAdmins() {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: {
        id: true,
        phone: true,
        email: true,
        name: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return admins.map((a) => ({
      id: a.id.toString(),
      phone: a.phone,
      email: a.email,
      name: a.name,
      role: a.role,
      status: a.status,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
  }


}
