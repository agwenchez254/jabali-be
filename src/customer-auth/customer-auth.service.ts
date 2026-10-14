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
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, UpdateMeDto } from './customer-auth.dto';
import { codesMatch, generateCode, hashCode, OTP } from './otp';
import { checkPassword } from './password-policy';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const ARGON = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 4 } as const;
// Keeps response time similar when the email does not exist.
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$Nl8bY2oYy0E3dLgKq8gqVwq2L8V6lGQy4vNn7qQe6hE';
const HOUR_MS = 3_600_000;

type Meta = { ip?: string; userAgent?: string };
type AccountWithCustomer = { id: string; email: string; displayName: string; customer: { id: string; name: string; phone: string } };

export interface CustomerView {
  id: string;
  name: string;
  email: string;
  phone: string;
}

/** What sign-up returns: no tokens, only what the verification screen needs. */
export interface VerificationStarted {
  email: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

/** The account's own name wins: a linked guest record's name (set by someone else) is never shown. */
const nameOf = (a: { displayName: string; customer: { name: string } }): string => a.displayName || a.customer.name;

const view = (a: AccountWithCustomer): CustomerView => ({ id: a.customer.id, name: nameOf(a), email: a.email, phone: a.customer.phone });

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
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private started(email: string): VerificationStarted {
    return { email, expiresInSeconds: OTP.ttlMinutes * 60, resendAfterSeconds: OTP.resendCooldownSeconds };
  }

  /**
   * Creates a pending account and emails the activation code. No tokens until the code is confirmed.
   * Signing up again with a pending email only re-sends the code: it never changes the password, so nobody can
   * hijack someone else's half-finished sign-up. An abandoned sign-up (code expired) frees its email and phone.
   */
  async register(dto: RegisterDto, meta: Meta): Promise<VerificationStarted> {
    const email = dto.email.trim().toLowerCase();
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'invalid_phone', 'Enter a valid Kenyan mobile number');
    const weak = checkPassword(dto.password, email);
    if (weak) throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'weak_password', weak);
    const passwordHash = await argon2.hash(dto.password, ARGON);
    const name = dto.name.trim();

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const byEmail = await tx.customerAccount.findUnique({ where: { email }, include: { customer: true } });
        if (byEmail) {
          if (byEmail.emailVerifiedAt) throw new DomainError(HttpStatus.CONFLICT, 'email_taken', CONFLICT_MESSAGE.email_taken);
          if (byEmail.verifyExpiresAt && byEmail.verifyExpiresAt > now) return { kind: 'pending' as const, account: byEmail };
          await tx.customerAccount.delete({ where: { id: byEmail.id } }); // abandoned sign-up
        }
        const existing = await tx.customer.findUnique({ where: { phone }, include: { account: true } });
        if (existing?.account) {
          const a = existing.account;
          const live = !a.emailVerifiedAt && !!a.verifyExpiresAt && a.verifyExpiresAt > now;
          if (a.emailVerifiedAt || live) throw new DomainError(HttpStatus.CONFLICT, 'phone_taken', CONFLICT_MESSAGE.phone_taken);
          await tx.customerAccount.delete({ where: { id: a.id } }); // abandoned sign-up
        }
        // A guest customer with this phone (earlier anonymous orders) is linked so they keep their history, but its
        // details are left untouched until the email is verified.
        const customer = existing ?? (await tx.customer.create({ data: { phone, name, email } }));
        const account = await tx.customerAccount.create({ data: { customerId: customer.id, email, passwordHash, displayName: name }, include: { customer: true } });
        return { kind: 'created' as const, account };
      });
      if (outcome.kind === 'pending') {
        // Someone else (or an attacker) already started this sign-up. Only the same password may continue it;
        // otherwise activating it would hand the real owner an account whose password they did not choose.
        const same = await argon2.verify(outcome.account.passwordHash, dto.password).catch(() => false);
        if (!same) {
          this.security.log('verification_failed', { accountId: outcome.account.id, ip: meta.ip, reason: 'signup_in_progress' });
          throw new DomainError(HttpStatus.CONFLICT, 'signup_in_progress', 'A sign-up for this email is already in progress. Use the code we emailed, or try again in a few minutes.');
        }
      }
      if (outcome.kind === 'created') this.security.log('register', { accountId: outcome.account.id, email, ip: meta.ip });
      await this.sendCode(outcome.account, nameOf(outcome.account));
      return this.started(email);
    } catch (e) {
      if (isUniqueViolation(e)) {
        const code = conflictCode(e);
        throw new DomainError(HttpStatus.CONFLICT, code, CONFLICT_MESSAGE[code]);
      }
      throw e;
    }
  }

  /**
   * Issues a fresh code unless the 60 second cool-down or the hourly cap says no. Callers never learn which
   * happened, so the response cannot be used to find out whether an email has a pending sign-up.
   */
  private async sendCode(
    account: { id: string; email: string; verifySentAt: Date | null; verifySendsThisHour: number; verifyWindowStart: Date | null },
    name: string,
  ): Promise<void> {
    const now = Date.now();
    if (account.verifySentAt && now - account.verifySentAt.getTime() < OTP.resendCooldownSeconds * 1000) return;
    const windowFresh = !!account.verifyWindowStart && now - account.verifyWindowStart.getTime() < HOUR_MS;
    const sends = windowFresh ? account.verifySendsThisHour : 0;
    if (sends >= OTP.maxSendsPerHour) return;
    const code = generateCode();
    await this.prisma.customerAccount.update({
      where: { id: account.id },
      data: {
        verifyCodeHash: hashCode(code, account.id, this.cfg.jwtAccessSecret),
        verifyExpiresAt: new Date(now + OTP.ttlMinutes * 60_000),
        verifyAttempts: 0,
        verifySentAt: new Date(now),
        verifySendsThisHour: sends + 1,
        verifyWindowStart: windowFresh ? account.verifyWindowStart : new Date(now),
      },
    });
    this.mail.sendVerificationCode(account.email, name, code, OTP.ttlMinutes);
    this.security.log('verification_sent', { accountId: account.id });
  }

  /** Sends another code to a pending account. Always resolves; silently does nothing for any other email. */
  async resend(emailRaw: string): Promise<void> {
    const account = await this.prisma.customerAccount.findUnique({ where: { email: emailRaw.trim().toLowerCase() }, include: { customer: true } });
    if (!account || account.emailVerifiedAt) return;
    await this.sendCode(account, nameOf(account));
  }

  /** Confirms the emailed code, activates the account, issues the first tokens and sends the welcome email. */
  async verify(emailRaw: string, code: string, password: string, meta: Meta) {
    const email = emailRaw.trim().toLowerCase();
    const invalid = (extra?: Record<string, unknown>) => new DomainError(HttpStatus.BAD_REQUEST, 'invalid_code', 'That code is not right', extra);
    const account = await this.prisma.customerAccount.findUnique({ where: { email }, include: { customer: true } });
    if (!account || account.emailVerifiedAt || !account.verifyCodeHash || !account.verifyExpiresAt) {
      this.security.log('verification_failed', { email, ip: meta.ip, reason: 'no_pending_code' });
      throw invalid();
    }
    if (account.verifyExpiresAt <= new Date()) {
      throw new DomainError(HttpStatus.BAD_REQUEST, 'code_expired', 'That code has expired. Request a new one.');
    }
    if (account.verifyAttempts >= OTP.maxAttempts) {
      throw new DomainError(HttpStatus.BAD_REQUEST, 'too_many_attempts', 'Too many wrong codes. Request a new one.');
    }
    // Both factors are always checked, so a wrong password and a wrong code look the same and cost the same.
    const codeOk = codesMatch(account.verifyCodeHash, hashCode(code, account.id, this.cfg.jwtAccessSecret));
    const passwordOk = await argon2.verify(account.passwordHash, password).catch(() => false);
    if (!codeOk || !passwordOk) {
      const updated = await this.prisma.customerAccount.update({ where: { id: account.id }, data: { verifyAttempts: { increment: 1 } } });
      this.security.log('verification_failed', { accountId: account.id, ip: meta.ip, reason: 'wrong_code_or_password' });
      throw invalid({ remainingAttempts: Math.max(0, OTP.maxAttempts - updated.verifyAttempts) });
    }
    // Claim atomically so two parallel requests with the right code cannot both activate and both get tokens.
    const claimed = await this.prisma.customerAccount.updateMany({
      where: { id: account.id, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date(), verifyCodeHash: null, verifyExpiresAt: null, verifyAttempts: 0 },
    });
    if (claimed.count !== 1) throw invalid();
    this.security.log('email_verified', { accountId: account.id, ip: meta.ip });
    this.mail.sendWelcome(account.email, nameOf(account));
    const tokens = await this.issue(account, randomUUID(), meta);
    return { customer: view(account), tokens };
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
    // Only someone who knows the password learns the account is waiting for its code.
    if (!account.emailVerifiedAt) {
      this.security.log('login_failed', { email: emailRaw, ip: meta.ip, accountId: account.id, reason: 'unverified' });
      throw new DomainError(HttpStatus.FORBIDDEN, 'email_not_verified', 'Verify your email to sign in');
    }
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
    if (!account || account.status !== 'active' || !account.emailVerifiedAt) throw new UnauthorizedException('Account disabled');
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

  /**
   * Only the account's own display name can be edited. The Customer record behind it may be a guest record created
   * by earlier orders (and shown to staff), so the account never writes to it, and the phone cannot be changed
   * until it can be verified.
   */
  async updateMe(accountId: string, dto: UpdateMeDto): Promise<CustomerView> {
    if (dto.name !== undefined) await this.prisma.customerAccount.update({ where: { id: accountId }, data: { displayName: dto.name.trim() } });
    return this.me(accountId);
  }

  private async issue(account: AccountWithCustomer, familyId: string, meta: Meta, replacesId?: string): Promise<TokenPair> {
    const payload: CustomerTokenPayload = { sub: account.id, typ: 'customer', cid: account.customer.id, email: account.email, name: nameOf(account) };
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
