import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { AnyStaff, AdminController, CurrentUser } from '../common/auth/decorators';
import { AuthUser } from '../common/auth/auth.types';
import { APP_CONFIG, AppConfig } from '../config/config';
import { LoginDto, RefreshDto } from './auth.dto';
import { AuthService } from './auth.service';
import { TokenPair } from './models';

export const REFRESH_COOKIE = 'jabali_rt';

@ApiTags('admin/auth')
@Controller('admin/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private cookieOpts(expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.cfg.nodeEnv === 'production',
      sameSite: 'lax',
      path: '/api/v1/admin/auth',
      expires,
    };
  }

  private body(user: unknown, t: TokenPair) {
    return {
      user,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresIn: t.expiresIn,
      refreshExpiresAt: t.refreshExpiresAt,
    };
  }

  /** Returns tokens in the body AND sets the httpOnly refresh cookie. */
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(dto.email, dto.password, { ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, this.cookieOpts(tokens.refreshExpiresAt));
    return this.body(user, tokens);
  }

  /** Rotates the refresh token. Send it in the body or rely on the cookie. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = dto.refreshToken ?? (req.cookies as Record<string, string | undefined>)?.[REFRESH_COOKIE];
    const { user, tokens } = await this.auth.refresh(raw, { ip: req.ip, userAgent: req.get('user-agent') });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, this.cookieOpts(tokens.refreshExpiresAt));
    return this.body(user, tokens);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = dto.refreshToken ?? (req.cookies as Record<string, string | undefined>)?.[REFRESH_COOKIE];
    await this.auth.logout(raw);
    res.clearCookie(REFRESH_COOKIE, this.cookieOpts());
  }
}

@AdminController('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @AnyStaff()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
