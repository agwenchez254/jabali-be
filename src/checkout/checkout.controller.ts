import { Body, Controller, Headers, HttpStatus, Module, Post, Res } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DomainError } from '../common/problem-details.filter';
import { CheckoutDto } from '../orders/orders.dto';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';

const KEY_RE = /^[A-Za-z0-9_\-:.]{8,100}$/;

@ApiTags('store')
@Controller('store/orders')
export class StoreCheckoutController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * Places an order: re-prices server-side, reserves stock transactionally and creates the payment.
   * 201 on creation, 200 when the same Idempotency-Key was already used (returns the original order).
   */
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated unique key (8-100 chars). Reuse it when retrying.' })
  async checkout(@Body() dto: CheckoutDto, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    if (!key || !KEY_RE.test(key)) {
      throw new DomainError(HttpStatus.BAD_REQUEST, 'idempotency_key_required', 'Send an Idempotency-Key header (8-100 chars: letters, digits, _ - : .)');
    }
    const { order, created } = await this.orders.checkout(dto, key);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    if (!created) return { order, payment: null, idempotentReplay: true };
    const payment = await this.payments.initiate(order.id).catch(() => null);
    return { order, payment, idempotentReplay: false };
  }
}

@Module({ imports: [OrdersModule, PaymentsModule], controllers: [StoreCheckoutController] })
export class CheckoutModule {}
