import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { TokenPair } from '../auth/models';
import { CustomerAuthUser } from '../common/auth/auth.types';
import { CurrentCustomer } from '../common/auth/customer.decorators';
import { CustomerAuthGuard } from '../common/auth/customer.guard';
import { perHour, perMinute, RateLimit } from '../common/rate-limit/rate-limit.guard';
import { CustomerLoginDto, CustomerRefreshDto, RegisterDto, ResendCodeDto, UpdateMeDto, VerifyEmailDto } from './customer-auth.dto';
import { CustomerAuthService, CustomerView, VerificationStarted } from './customer-auth.service';
import { OTP } from './otp';

const body = (customer: CustomerView, t: TokenPair) => ({
  customer,
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  expiresIn: t.expiresIn,
  refreshExpiresAt: t.refreshExpiresAt,
});

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

@ApiTags('store')
@Controller('store/auth')
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  @Post('register')
  @RateLimit(perMinute('register', 5, 'ip'), perHour('register-email', 6, 'email'))
  /** Creates a pending account and emails a 6-digit code. Tokens only come from `verify`. */
  async register(@Body() dto: RegisterDto, @Req() req: Request): Promise<VerificationStarted> {
    return this.auth.register(dto, meta(req));
  }

  /** Confirms the emailed code: activates the account and returns the first tokens. */
  @Post('verify')
  @HttpCode(200)
  @RateLimit(perMinute('verify', 10, 'ip'), perMinute('verify-email', 10, 'email'))
  async verify(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    const { customer, tokens } = await this.auth.verify(dto.email, dto.code, dto.password, meta(req));
    return body(customer, tokens);
  }

  /** Always 200 with the same body, whatever the email, so it cannot be used to probe for accounts. */
  @Post('resend')
  @HttpCode(200)
  @RateLimit(perMinute('resend', 5, 'ip'), perMinute('resend-email', 5, 'email'))
  async resend(@Body() dto: ResendCodeDto): Promise<{ resendAfterSeconds: number }> {
    await this.auth.resend(dto.email);
    return { resendAfterSeconds: OTP.resendCooldownSeconds };
  }

  @Post('login')
  @HttpCode(200)
  @RateLimit(perMinute('login', 10, 'ip'), perMinute('login-email', 5, 'email'))
  async login(@Body() dto: CustomerLoginDto, @Req() req: Request) {
    const { customer, tokens } = await this.auth.login(dto.email, dto.password, meta(req));
    return body(customer, tokens);
  }

  @Post('refresh')
  @HttpCode(200)
  @RateLimit(perMinute('refresh', 30, 'ip'))
  async refresh(@Body() dto: CustomerRefreshDto, @Req() req: Request) {
    const { customer, tokens } = await this.auth.refresh(dto.refreshToken, meta(req));
    return body(customer, tokens);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: CustomerRefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }
}

@ApiTags('store')
@ApiBearerAuth()
@UseGuards(CustomerAuthGuard)
@Controller('store/me')
export class StoreMeController {
  constructor(private readonly auth: CustomerAuthService) {}

  @Get()
  me(@CurrentCustomer() c: CustomerAuthUser) {
    return this.auth.me(c.accountId);
  }

  @Patch()
  update(@CurrentCustomer() c: CustomerAuthUser, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(c.accountId, dto);
  }
}
