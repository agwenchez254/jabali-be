import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AccessTokenPayload } from '../common/auth/auth.types';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { SessionUser, TokenPair } from './models';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
// Used to keep response time similar when the email does not exist.
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$Nl8bY2oYy0E3dLgKq8gqVwq2L8V6lGQy4vNn7qQe6hE';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const staff = await this.prisma.staffUser.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { role: { include: { permissions: true } } },
    });
    if (!staff) {
      await argon2.verify(DUMMY_HASH, password).catch(() => false);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }
    const ok = await argon2.verify(staff.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = staff.failedLogins + 1;
      await this.prisma.staffUser.update({
        where: { id: staff.id },
        data: {
          failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (staff.status !== 'active') throw new UnauthorizedException('Account disabled');

    await this.prisma.staffUser.update({
      where: { id: staff.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const user: SessionUser = {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role.name,
      permissions: staff.role.permissions.map((p) => p.permission).sort(),
    };
    const tokens = await this.issue(user, randomUUID(), meta);
    return { user, tokens };
  }

  async refresh(raw: string | undefined, meta: { ip?: string; userAgent?: string }) {
    if (!raw) throw new UnauthorizedException('Missing refresh token');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    if (row.revokedAt) {
      // reuse of a rotated token: assume theft and kill the whole family
      await this.prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (row.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');

    // Atomically claim the token so two parallel refreshes cannot both succeed.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) throw new UnauthorizedException('Refresh token already used');

    const staff = await this.prisma.staffUser.findUnique({
      where: { id: row.staffId },
      include: { role: { include: { permissions: true } } },
    });
    if (!staff || staff.status !== 'active') throw new UnauthorizedException('Account disabled');
    const user: SessionUser = {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      role: staff.role.name,
      permissions: staff.role.permissions.map((p) => p.permission).sort(),
    };
    const tokens = await this.issue(user, row.familyId, meta, row.id);
    return { user, tokens };
  }

  async logout(raw: string | undefined): Promise<void> {
    if (!raw) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!row) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<SessionUser & { lastLoginAt: Date | null }> {
    const s = await this.prisma.staffUser.findUniqueOrThrow({
      where: { id: userId },
      include: { role: { include: { permissions: true } } },
    });
    return {
      id: s.id,
      name: s.name,
      email: s.email,
      role: s.role.name,
      permissions: s.role.permissions.map((p) => p.permission).sort(),
      lastLoginAt: s.lastLoginAt,
    };
  }

  private async issue(
    user: SessionUser,
    familyId: string,
    meta: { ip?: string; userAgent?: string },
    replacesId?: string,
  ): Promise<TokenPair> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: user.permissions,
    };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.cfg.refreshTtlDays * 86_400_000);
    const created = await this.prisma.refreshToken.create({
      data: {
        staffId: user.id,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: refreshExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 250),
      },
    });
    if (replacesId) {
      await this.prisma.refreshToken.update({ where: { id: replacesId }, data: { replacedById: created.id } });
    }
    return { accessToken, refreshToken, expiresIn: this.cfg.jwtAccessTtlSeconds, refreshExpiresAt };
  }
}
