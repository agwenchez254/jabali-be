import {
  applyDecorators,
  Controller,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditInterceptor, AUDIT_ENTITY } from '../audit.interceptor';
import { Permission } from '../permissions';
import { AuthUser } from './auth.types';
import { JwtAuthGuard, PermissionsGuard } from './guards';

import { ANY_STAFF, REQUIRE_PERMISSIONS } from './constants';

/** Route needs ALL listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRE_PERMISSIONS, permissions);

/** Route only needs a valid staff token (e.g. /admin/me). */
export const AnyStaff = () => SetMetadata(ANY_STAFF, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return req.user;
});

/**
 * Controller under /api/v1/admin/<path>: JWT required, permissions enforced
 * (fail-closed: a route without @RequirePermissions or @AnyStaff is rejected),
 * writes are audit-logged and invalidate the store cache.
 */
export function AdminController(path: string, entity?: string) {
  return applyDecorators(
    Controller(`admin/${path}`),
    ApiTags(`admin/${path.split('/')[0]}`),
    ApiBearerAuth(),
    UseGuards(JwtAuthGuard, PermissionsGuard),
    UseInterceptors(AuditInterceptor),
    SetMetadata(AUDIT_ENTITY, entity ?? path.split('/')[0]),
  );
}
