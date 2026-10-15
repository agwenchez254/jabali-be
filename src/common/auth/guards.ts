import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest as Request } from 'fastify';
import { SecurityLogService } from '../security-log/security-log.service';
import { AccessTokenPayload, AuthUser } from './auth.types';

import { ANY_STAFF, REQUIRE_PERMISSIONS } from './constants';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly security: SecurityLogService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    try {
      const p = await this.jwt.verifyAsync<AccessTokenPayload & { typ?: string }>(header.slice(7));
      if (p.typ === 'customer') {
        this.security.log('token_type_rejected', { ip: req.ip, expected: 'staff' });
        throw new UnauthorizedException('Invalid or expired token');
      }
      req.user = { id: p.sub, email: p.email, name: p.name, role: p.role, permissions: p.permissions };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const anyStaff = this.reflector.getAllAndOverride<boolean>(ANY_STAFF, targets);
    if (anyStaff) return true;
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSIONS, targets);
    if (!required || required.length === 0) {
      throw new ForbiddenException('Route has no permission policy');
    }
    const user = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user;
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    return true;
  }
}
