/**
 * MJAPP — Auth Module
 * Handles: OTP send/verify, JWT issue, refresh token, social login
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { jwtSecret } from './security';
import { CustomerAuthService } from './customer-auth.service';
import { IdentityVerifier } from './identity-verifier';
import { EmailLoginDelivery } from './email-login-delivery';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ManagementPasswordController } from './management-password.controller';
import { ManagementPasswordService } from './management-password.service';
import { CustomerPasswordController } from './customer-password.controller';
import { CustomerPasswordService } from './customer-password.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: jwtSecret(),
        signOptions: {
          expiresIn: '15m',
        },
      }),
    }),
  ],
  controllers: [AuthController, ManagementPasswordController, CustomerPasswordController],
  providers: [AuthService, JwtStrategy, CustomerAuthService, IdentityVerifier, EmailLoginDelivery, RolesGuard, ManagementPasswordService, CustomerPasswordService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
