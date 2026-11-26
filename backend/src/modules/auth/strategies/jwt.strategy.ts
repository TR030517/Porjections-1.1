import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { jwtSecret } from '../security';
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: jwtSecret(), algorithms: ['HS256'] }); }
  async validate(payload: { sub: string; sid: string }) {
    if (!/^\d+$/.test(payload.sub || '') || !payload.sid) throw new UnauthorizedException();
    const session = await this.prisma.authSession.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (!session || session.userId.toString() !== payload.sub || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') throw new UnauthorizedException('Session unavailable');
    return { id: session.user.id.toString(), phone: session.user.phone, role: session.user.role, sessionId: session.id };
  }
}
