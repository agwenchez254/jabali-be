import { Controller, Header, HttpStatus, MessageEvent, Req, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { defer, filter, finalize, interval, map, merge, Observable } from 'rxjs';
import { AuthUser, CustomerAuthUser } from '../common/auth/auth.types';
import { CurrentCustomer } from '../common/auth/customer.decorators';
import { CustomerAuthGuard } from '../common/auth/customer.guard';
import { CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { JwtAuthGuard, PermissionsGuard } from '../common/auth/guards';
import { DomainError } from '../common/problem-details.filter';
import { ConnectionCounter } from '../common/rate-limit/rate-limiter';
import { forCustomer, NotificationsService } from './notifications.service';

export const HEARTBEAT_MS = 25_000;
export const MAX_STREAMS_PER_ACCOUNT = 5;

const beat = () => interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: '' })));

/** Live order events for staff. Browsers cannot set headers on EventSource, so clients read this with fetch. */
@ApiTags('admin/notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  private readonly streams = new ConnectionCounter();

  constructor(private readonly notifications: NotificationsService) {}

  /** `order` events: a new order, or an order moving to a new status. */
  @Sse('stream')
  @RequirePermissions('order:read')
  @Header('X-Accel-Buffering', 'no')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const release = this.streams.acquire(user.id, MAX_STREAMS_PER_ACCOUNT);
    if (!release) throw new DomainError(HttpStatus.TOO_MANY_REQUESTS, 'too_many_streams', 'Too many open connections');
    const orders = this.notifications.events$.pipe(map((n): MessageEvent => ({ type: 'order', id: n.id, data: n })));
    return defer(() => merge(orders, beat())).pipe(finalize(release));
  }
}

/** Live updates about the signed-in customer's own orders. */
@ApiTags('store')
@ApiBearerAuth()
@UseGuards(CustomerAuthGuard)
@Controller('store/me')
export class CustomerNotificationsController {
  private readonly streams = new ConnectionCounter();

  constructor(private readonly notifications: NotificationsService) {}

  @Sse('notifications')
  @Header('X-Accel-Buffering', 'no')
  stream(@CurrentCustomer() c: CustomerAuthUser, @Req() _req: FastifyRequest): Observable<MessageEvent> {
    const release = this.streams.acquire(c.accountId, MAX_STREAMS_PER_ACCOUNT);
    if (!release) throw new DomainError(HttpStatus.TOO_MANY_REQUESTS, 'too_many_streams', 'Too many open connections');
    const mine = this.notifications.events$.pipe(
      filter((n) => n.customerId === c.customerId),
      map((n): MessageEvent => ({ type: 'order', id: n.id, data: forCustomer(n) })),
    );
    return defer(() => merge(mine, beat())).pipe(finalize(release));
  }
}
