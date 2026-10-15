import { Body, Controller, Headers, HttpCode, HttpStatus, Module, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CustomerAuthUser } from '../common/auth/auth.types';
import { CurrentCustomer } from '../common/auth/customer.decorators';
import { CustomerAuthGuard } from '../common/auth/customer.guard';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { DomainError } from '../common/problem-details.filter';
import { MailService } from '../mail/mail.service';
import { CheckoutDto } from '../orders/orders.dto';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';

export class PayOrderDto {
  /** Mobile-money number to prompt. Defaults to the number used at checkout. */
  @IsOptional() @IsString() @MaxLength(20) payerPhone?: string;
}

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
    private readonly prisma: PrismaService,
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
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    if (!key || !KEY_RE.test(key)) {
      throw new DomainError(HttpStatus.BAD_REQUEST, 'idempotency_key_required', 'Send an Idempotency-Key header (8-100 chars: letters, digits, _ - : .)');
    }
    const { order, created } = await this.orders.checkout(dto, key, customer.customerId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    // Only for a newly created order: an idempotent replay must not email the receipt again.
    // The greeting uses the account's own name, never the name stored on a linked guest record.
    // The response and the email show the account's own name and email, never those on a linked guest record,
    // which may have been written by someone else who used the same phone number.
    const own = { ...order, customer: { ...order.customer, name: customer.name, email: customer.email } };
    if (created) this.mail.sendOrderConfirmation(customer.email, own);
    if (!created) return { order: own, payment: null, idempotentReplay: true };
    const payment = await this.payments.initiate(order.id, dto.payerPhone).catch(() => null);
    return { order: own, payment, idempotentReplay: false };
  }

  /**
   * (Re)sends the payment prompt for the signed-in customer's own pending order, to the number they choose.
   * Unlike the public M-Pesa retry, the number can differ from the account's phone because the caller is authenticated.
   */
  @Post(':number/pay')
  @HttpCode(200)
  async pay(@Param('number') number: string, @Body() dto: PayOrderDto, @CurrentCustomer() customer: CustomerAuthUser) {
    const order = await this.prisma.order.findUnique({ where: { number: number.toUpperCase() }, select: { id: true, customerId: true } });
    if (!order || order.customerId !== customer.customerId) throw new NotFoundException('Order not found');
    return this.payments.initiate(order.id, dto.payerPhone?.trim() || undefined);
  }
}

@Module({ imports: [OrdersModule, PaymentsModule], controllers: [StoreCheckoutController] })
export class CheckoutModule {}
