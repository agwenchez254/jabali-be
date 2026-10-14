import { Body, Controller, Headers, HttpStatus, Module, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CustomerAuthUser } from '../common/auth/auth.types';
import { CurrentCustomer } from '../common/auth/customer.decorators';
import { CustomerAuthGuard } from '../common/auth/customer.guard';
import { DomainError } from '../common/problem-details.filter';
import { MailService } from '../mail/mail.service';
import { CheckoutDto } from '../orders/orders.dto';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';

const KEY_RE = /^[A-Za-z0-9_\-:.]{8,100}$/;

@ApiTags('store')
@ApiBearerAuth()
@UseGuards(CustomerAuthGuard)
@Controller('store/orders')
export class StoreCheckoutController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly mail: MailService,
  ) {}

  /**
   * Places an order: re-prices server-side, reserves stock transactionally and creates the payment.
   * 201 on creation, 200 when the same Idempotency-Key was already used (returns the original order).
   */
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated unique key (8-100 chars). Reuse it when retrying.' })
  async checkout(
    @Body() dto: CheckoutDto,
    @CurrentCustomer() customer: CustomerAuthUser,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!key || !KEY_RE.test(key)) {
      throw new DomainError(HttpStatus.BAD_REQUEST, 'idempotency_key_required', 'Send an Idempotency-Key header (8-100 chars: letters, digits, _ - : .)');
    }
    const { order, created } = await this.orders.checkout(dto, key, customer.customerId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    // Only for a newly created order: an idempotent replay must not email the receipt again.
    // The greeting uses the account's own name, never the name stored on a linked guest record.
    if (created) this.mail.sendOrderConfirmation(customer.email, { ...order, customer: { ...order.customer, name: customer.name } });
    if (!created) return { order, payment: null, idempotentReplay: true };
    const payment = await this.payments.initiate(order.id).catch(() => null);
    return { order, payment, idempotentReplay: false };
  }
}

@Module({ imports: [OrdersModule, PaymentsModule], controllers: [StoreCheckoutController] })
export class CheckoutModule {}
