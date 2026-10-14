import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { DomainError } from '../problem-details.filter';
import { SecurityLogService } from '../security-log/security-log.service';
import { RateLimiter } from './rate-limiter';

export interface RateRule {
  name: string;
  limit: number;
  windowMs: number;
  by: 'ip' | 'email';
}

const RATE_RULES = 'rate_rules';
const MINUTE = 60_000;

export const DEFAULT_RULE: RateRule = { name: 'default', limit: 120, windowMs: MINUTE, by: 'ip' };

/** Extra limits for one route, on top of the global per-IP default. */
export const RateLimit = (...rules: RateRule[]) => SetMetadata(RATE_RULES, rules);

export const perMinute = (name: string, limit: number, by: 'ip' | 'email'): RateRule => ({ name, limit, windowMs: MINUTE, by });

export const perHour = (name: string, limit: number, by: 'ip' | 'email'): RateRule => ({ name, limit, windowMs: 60 * MINUTE, by });

const SKIP_RATE_LIMIT = 'skip_rate_limit';

/** For machine callers that must never be throttled, such as payment provider callbacks (they are authenticated by other means). */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly reflector: Reflector,
    private readonly security: SecurityLogService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.cfg.rateLimitEnabled) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [ctx.getHandler(), ctx.getClass()])) return true;
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const rules = [DEFAULT_RULE, ...(this.reflector.getAllAndOverride<RateRule[]>(RATE_RULES, [ctx.getHandler(), ctx.getClass()]) ?? [])];
    for (const rule of rules) {
      const subject = rule.by === 'ip' ? (req.ip ?? 'unknown') : emailOf(req);
      if (!subject) continue;
      // Route rules are keyed by route path so one route's traffic cannot use up another route's allowance.
      const path = rule.name === 'default' ? '' : ((req.route as { path?: string } | undefined)?.path ?? '');
      const r = this.limiter.hit(`${rule.name}:${rule.by}:${path}:${subject}`, rule.limit, rule.windowMs);
      if (!r.allowed) {
        res.setHeader('Retry-After', String(r.retryAfterSec));
        this.security.log('rate_limited', { rule: rule.name, ip: req.ip });
        throw new DomainError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many requests. Please wait and try again.');
      }
    }
    return true;
  }
}

function emailOf(req: Request): string | null {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.length <= 254 ? email.trim().toLowerCase() : null;
}
