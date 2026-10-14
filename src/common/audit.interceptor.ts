import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from './cache/cache.service';
import { StoreEventsService } from '../store-events/store-events.service';
import { AuthUser } from './auth/auth.types';

export const AUDIT_ENTITY = 'audit_entity';
const SKIP_AUDIT = 'skip_audit';
/** Marks a POST handler that does not change state (e.g. previews) so it is not audited. */
export const NoAudit = () => SetMetadata(SKIP_AUDIT, true);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SECRET_KEYS = /password|token|secret|hash/i;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(redact(value))) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

/**
 * Writes an audit_log row for every successful admin write (POST/PUT/PATCH/DELETE)
 * and invalidates the storefront cache. `before` holds the redacted request body,
 * `after` the redacted response.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly log = new Logger('Audit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly events: StoreEventsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!WRITE_METHODS.has(req.method) || this.reflector.get<boolean>(SKIP_AUDIT, ctx.getHandler())) return next.handle();
    const entity = this.reflector.get<string>(AUDIT_ENTITY, ctx.getClass()) ?? 'unknown';
    const body = req.body as unknown;

    return next.handle().pipe(
      tap((result) => {
        const res = result as { id?: unknown } | undefined;
        const paramId = (req.params as Record<string, string | undefined>).id;
        const entityId = paramId ?? (typeof res?.id === 'string' ? res.id : undefined);
        void this.prisma.auditLog
          .create({
            data: {
              actorId: req.user?.id,
              action: `${req.method} ${req.route?.path ?? req.path}`,
              entity,
              entityId,
              before: toJson(body),
              after: toJson(result),
              ip: req.ip,
            },
          })
          .catch((e: unknown) => this.log.error(`audit write failed: ${String(e)}`));
        // Clear the cache first so the storefront's refetch cannot read stale data.
        void this.cache.invalidate().then(() => this.events.emitForEntity(entity));
      }),
    );
  }
}
