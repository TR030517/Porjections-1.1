import { Body, Controller, ForbiddenException, Get, GoneException, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SendOtpDto, VerifyOtpDto, RefreshTokenDto, SocialLoginDto, PasswordLoginDto, EmailPasswordLoginDto, EmailLoginRequestDto, EmailLoginVerifyDto, SocialChallengeDto, LinkProviderDto } from './dto/auth.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { CustomerAuthService } from './customer-auth.service';
import { IdentityProvider } from './identity-verifier';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

const COOKIE = 'massajoy_refresh';
const CUSTOMER_COOKIE = 'massajoy_customer_refresh';
const cookieOptions = (customer = false) => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: customer ? '/api/v1/auth/customer' : '/api/v1/auth', maxAge: 7 * 86400000 });
export function assertTrustedOrigin(req: Request, cookieAuth = false) {
  const origin = req.headers.origin;
  const allowed = (process.env.CORS_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  const self = `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== self && !allowed.includes(origin)) throw new ForbiddenException('Untrusted request origin');
  if (cookieAuth && (!origin || req.headers['sec-fetch-site'] === 'cross-site')) throw new ForbiddenException('Cookie authentication requires a trusted origin');
}
function cookieToken(req: Request, customer = false) {
  const name = customer ? CUSTOMER_COOKIE : COOKIE;
  const value = (req.headers.cookie || '').split(';').find(x => x.trim().startsWith(`${name}=`));
  if (!value) return '';
  try { return decodeURIComponent(value.trim().slice(name.length + 1)); } catch { return ''; }
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly customer: CustomerAuthService) {}
  @Get('customer/config')
  customerConfig(@Res({ passthrough: true }) res: Response) { res.setHeader('Cache-Control','no-store'); return this.customer.config(); }
  @Post('customer/password/login') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  async customerPassword(@Body() dto: EmailPasswordLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertTrustedOrigin(req); return this.result(req,res,await this.auth.passwordLogin(dto.email,dto.password,'CUSTOMER'),true);
  }
  @Post('customer/email/request') @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 60000 } })
  emailRequest(@Body() dto: EmailLoginRequestDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { assertTrustedOrigin(req); res.setHeader('Cache-Control','no-store'); return this.customer.requestEmail(dto.email); }
  @Post('customer/email/verify') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  async emailVerify(@Body() dto: EmailLoginVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { assertTrustedOrigin(req); return this.result(req,res,await this.customer.verifyEmail(dto.challengeId,dto.code),true); }
  @Post('customer/email/verify-current') @HttpCode(200) @UseGuards(AuthGuard('jwt'), RolesGuard) @Roles('CUSTOMER') @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyCurrentEmail(@Body() dto: EmailLoginVerifyDto, @Req() req: Request, @GetUser('id') userId: string) { assertTrustedOrigin(req); return this.customer.verifyCurrentEmail(userId,dto.challengeId,dto.code); }
  @Post('customer/social/challenge') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  socialChallenge(@Body() dto: SocialChallengeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { assertTrustedOrigin(req); res.setHeader('Cache-Control','no-store'); return this.customer.socialChallenge(dto.provider); }
  @Post('customer/providers/:provider/link') @UseGuards(AuthGuard('jwt')) @Throttle({ default: { limit: 5, ttl: 60000 } })
  linkProvider(@Param('provider') provider: IdentityProvider, @Body() dto: LinkProviderDto, @GetUser('id') userId: string, @GetUser('sessionId') sessionId: string, @Req() req: Request) { assertTrustedOrigin(req); return this.customer.linkProvider(userId,provider,dto,sessionId); }
  @Post('register') @Throttle({ default: { limit: 5, ttl: 60000 } })
  register(@Req() req: Request): never {
    assertTrustedOrigin(req);
    throw new GoneException({ code: 'CUSTOMER_REGISTRATION_REQUIRES_VERIFIED_EMAIL', message: 'Create a customer account with an email verification code or an enabled identity provider.' });
  }
  private result(req: Request, res: Response, result: any, customer = false) {
    res.setHeader('Cache-Control', 'no-store');
    res.cookie(customer ? CUSTOMER_COOKIE : COOKIE, result.refreshToken, cookieOptions(customer));
    if (req.headers.origin || req.headers['sec-fetch-site']) { const { refreshToken: _token, ...browserResult } = result; return browserResult; }
    return result;
  }
  @Post('login') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(@Body() dto: PasswordLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertTrustedOrigin(req); return this.result(req, res, await this.auth.passwordLogin(dto.identifier, dto.password));
  }
  @Post('admin/password/login') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  async adminPasswordLogin(@Body() dto: PasswordLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertTrustedOrigin(req); return this.result(req, res, await this.auth.passwordLogin(dto.identifier, dto.password, 'ADMIN'));
  }
  @Post('password/login') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  async passwordLogin(@Body() dto: EmailPasswordLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertTrustedOrigin(req); return this.result(req, res, await this.auth.passwordLogin(dto.email, dto.password));
  }
  @Post('refresh') @HttpCode(200)
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = cookieToken(req); assertTrustedOrigin(req, !dto?.refreshToken && !!cookie);
    return this.result(req, res, await this.auth.refreshToken(dto?.refreshToken || cookie));
  }
  @Post('admin/refresh') @HttpCode(200)
  async adminRefresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = cookieToken(req); assertTrustedOrigin(req, !dto?.refreshToken && !!cookie);
    return this.result(req, res, await this.auth.refreshToken(dto?.refreshToken || cookie, 'ADMIN'));
  }
  @Post('customer/refresh') @HttpCode(200)
  async customerRefresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = cookieToken(req, true); assertTrustedOrigin(req, !dto?.refreshToken && !!cookie);
    return this.result(req, res, await this.auth.refreshToken(dto?.refreshToken || cookie, 'CUSTOMER'), true);
  }
  @Post('logout') @HttpCode(200)
  async logout(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = cookieToken(req); assertTrustedOrigin(req, !dto?.refreshToken && !!cookie);
    const result = await this.auth.logout(dto?.refreshToken || cookie);
    // The server revokes the captured session. A late logout response must not
    // erase a newer login's cookie in the same browser.
    res.setHeader('Cache-Control', 'no-store'); return result;
  }
  @Post('customer/logout') @HttpCode(200)
  async customerLogout(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = cookieToken(req, true); assertTrustedOrigin(req, !dto?.refreshToken && !!cookie);
    const result = await this.auth.logout(dto?.refreshToken || cookie, 'CUSTOMER');
    res.setHeader('Cache-Control', 'no-store'); return result;
  }
  @Get('me') @UseGuards(AuthGuard('jwt'))
  me(@GetUser('id') id: string) { return this.auth.me(id); }
  @Post('send-otp') @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 60000 } })
  sendOtp(@Body() dto: SendOtpDto, @Req() req: Request) { assertTrustedOrigin(req); return this.auth.sendOtp(dto.phone); }
  @Post('verify-otp') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertTrustedOrigin(req); return this.result(req, res, await this.auth.verifyOtp(dto.phone, dto.code), true);
  }
  @Post('apple') @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async apple(@Body() dto: SocialLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { assertTrustedOrigin(req); return this.result(req,res,await this.customer.socialLogin('APPLE',dto),true); }
  @Post('google') @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async google(@Body() dto: SocialLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { assertTrustedOrigin(req); return this.result(req,res,await this.customer.socialLogin('GOOGLE',dto),true); }
}
