import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthUser } from '../common/auth/auth.types';
import { AdminController, CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { AdminOrderListQuery, RefundDto, TrackQuery, TransitionDto } from './orders.dto';
import { OrdersService } from './orders.service';

@AdminController('orders', 'order')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get() @RequirePermissions('order:read')
  list(@Query() q: AdminOrderListQuery) {
    return this.orders.list(q);
  }

  /** CSV of the filtered list (max 10 000 rows). */
  @Get('export') @RequirePermissions('order:read')
  async export(@Query() q: AdminOrderListQuery, @Res({ passthrough: true }) res: FastifyReply): Promise<string> {
    res.type('text/csv').header('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    return this.orders.exportCsv(q);
  }

  @Get(':id') @RequirePermissions('order:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  /** Moves the order along the state machine. The response lists `allowedTransitions` for the new state. */
  @Post(':id/transition') @HttpCode(200) @RequirePermissions('order:write')
  transition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    if (dto.to === 'refunded' && !user.permissions.includes('order:refund')) {
      throw new ForbiddenException('Missing permission: order:refund');
    }
    return this.orders.transition(id, dto.to, { id: user.id }, dto.note);
  }

  @Post(':id/refund') @HttpCode(200) @RequirePermissions('order:refund')
  refund(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDto, @CurrentUser() user: AuthUser) {
    return this.orders.transition(id, 'refunded', { id: user.id }, dto.note);
  }
}

@ApiTags('store')
@Controller('store/orders')
export class StoreOrderTrackingController {
  constructor(private readonly orders: OrdersService) {}

  /** GET /store/orders/JB-000123?phone=0712345678 */
  @Get(':number')
  track(@Param('number') number: string, @Query() q: TrackQuery) {
    return this.orders.track(number, q.phone);
  }
}
