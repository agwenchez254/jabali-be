import { HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from '../auth/auth.service';
import { TokenPair } from '../auth/models';
import { CustomerTokenPayload } from '../common/auth/auth.types';
import { DomainError } from '../common/problem-details.filter';
import { SecurityLogService } from '../common/security-log/security-log.service';
import { isUniqueViolation, normalizePhone } from '../common/utils';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, UpdateMeDto } from './customer-auth.dto';
import { checkPassword } from './password-policy';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const ARGON = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 4 } as const;
// Keeps response time similar when the email does not exist.
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$Nl8bY2oYy0E3dLgKq8gqVwq2L8V6lGQy4vNn7qQe6hE';

type Meta = { ip?: string; userAgent?: string };
type AccountWithCustomer = { id: string; email: string; customer: { id: string; name: string; phone: string } };

export interface CustomerView {
  id: string;
  name: string;
  email: string;
  phone: string;
}

const view = (a: AccountWithCustomer): CustomerView => ({ id: a.customer.id, name: a.customer.name, email: a.email, phone: a.customer.phone });

/** Which unique constraint a P2002 error hit, as the API error code. */
function conflictCode(e: unknown): 'email_taken' | 'phone_taken' {
  const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? '');
  return target.includes('email') ? 'email_taken' : 'phone_taken';
}

const CONFLICT_MESSAGE = {
  email_taken: 'An account with this email already exists',
  phone_taken: 'An account already exists for this phone number',
} as const;

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly security: SecurityLogService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async register(dto: RegisterDto, meta: Meta) {
    const email = dto.email.trim().toLowerCase();
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'invalid_phone', 'Enter a valid Kenyan mobile number');
    const weak = checkPassword(dto.password, email);
    if (weak) throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'weak_password', weak);
    const passwordHash = await argon2.hash(dto.password, ARGON);
    const name = dto.name.trim();

    try {
      const account = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.customer.findUnique({ where: { phone }, include: { account: true } });
        if (existing?.account) throw new DomainError(HttpStatus.CONFLICT, 'phone_taken', CONFLICT_MESSAGE.phone_taken);
        // A guest customer with this phone (earlier anonymous orders) is claimed so they keep their history.
        const customer = existing
          ? await tx.customer.update({ where: { id: existing.id }, data: { name, email: existing.email ?? email } })
          : await tx.customer.create({ data: { phone, name, email } });
        return tx.customerAccount.create({ data: { customerId: customer.id, email, passwordHash }, include: { customer: true } });
      });
      const tokens = await this.issue(account, randomUUID(), meta);
      this.security.log('register', { accountId: account.id, email, ip: meta.ip });
      return { customer: view(account), tokens };
    } catch (e) {
      if (isUniqueViolation(e)) {
        const code = conflictCode(e);
        throw new DomainError(HttpStatus.CONFLICT, code, CONFLICT_MESSAGE[code]);
      }
      throw e;
    }
  }

  async login(emailRaw: string, password: string, meta: Meta) {
    const account = await this.prisma.customerAccount.findUnique({ where: { email: emailRaw.trim().toLowerCase() }, include: { customer: true } });
    if (!account) {
      await argon2.verify(DUMMY_HASH, password).catch(() => false);
      this.security.log('login_failed', { email: emailRaw, ip: meta.ip, reason: 'unknown_email' });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      this.security.log('login_failed', { email: emailRaw, ip: meta.ip, accountId: account.id, reason: 'locked' });
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await argon2.verify(account.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = account.failedLogins + 1;
      this.security.log('login_failed', { email: emailRaw, ip: meta.ip, accountId: account.id, reason: 'bad_password' });
      if (failed >= MAX_FAILED_LOGINS) this.security.log('account_locked', { accountId: account.id, ip: meta.ip });
      await this.prisma.customerAccount.update({
        where: { id: account.id },
        data: {
          failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (account.status !== 'active') throw new UnauthorizedException('Invalid email or password');
    await this.prisma.customerAccount.update({ where: { id: account.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    this.security.log('login_success', { accountId: account.id, ip: meta.ip });
    const tokens = await this.issue(account, randomUUID(), meta);
    return { customer: view(account), tokens };
  }

  async refresh(raw: string, meta: Meta) {
    const row = await this.prisma.customerRefreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    if (row.revokedAt) {
      this.security.log('refresh_reuse', { accountId: row.accountId, ip: meta.ip });
      // reuse of a rotated token: assume theft and kill the whole family
      await this.prisma.customerRefreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (row.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');
    // Atomically claim the token so two parallel refreshes cannot both succeed.
    const claimed = await this.prisma.customerRefreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count !== 1) throw new UnauthorizedException('Refresh token already used');
    const account = await this.prisma.customerAccount.findUnique({ where: { id: row.accountId }, include: { customer: true } });
    if (!account || account.status !== 'active') throw new UnauthorizedException('Account disabled');
    const tokens = await this.issue(account, row.familyId, meta, row.id);
    return { customer: view(account), tokens };
  }

  async logout(raw: string): Promise<void> {
    const row = await this.prisma.customerRefreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!row) return;
    await this.prisma.customerRefreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async me(accountId: string): Promise<CustomerView> {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, include: { customer: true } });
    return view(account);
  }

  async updateMe(accountId: string, dto: UpdateMeDto): Promise<CustomerView> {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId } });
    const data: { name?: string; phone?: string } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) {
      const phone = normalizePhone(dto.phone);
      if (!phone) throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'invalid_phone', 'Enter a valid Kenyan mobile number');
      data.phone = phone;
    }
    try {
      await this.prisma.customer.update({ where: { id: account.customerId }, data });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError(HttpStatus.CONFLICT, 'phone_taken', CONFLICT_MESSAGE.phone_taken);
      throw e;
    }
    return this.me(accountId);
  }

  private async issue(account: AccountWithCustomer, familyId: string, meta: Meta, replacesId?: string): Promise<TokenPair> {
    const payload: CustomerTokenPayload = { sub: account.id, typ: 'customer', cid: account.customer.id, email: account.email, name: account.customer.name };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.cfg.refreshTtlDays * 86_400_000);
    const created = await this.prisma.customerRefreshToken.create({
      data: {
        accountId: account.id,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: refreshExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 250),
      },
    });
    if (replacesId) await this.prisma.customerRefreshToken.update({ where: { id: replacesId }, data: { replacedById: created.id } });
    return { accessToken, refreshToken, expiresIn: this.cfg.jwtAccessTtlSeconds, refreshExpiresAt };
  }
}
