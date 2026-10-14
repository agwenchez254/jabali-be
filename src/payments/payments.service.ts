import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentProvider, Prisma } from '@prisma/client';
import { DomainError } from '../common/problem-details.filter';
import { normalizePhone } from '../common/utils';
import { APP_CONFIG, AppConfig } from '../config/config';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CodProvider } from './providers/cod.provider';
import { MockProvider } from './providers/mock.provider';
import { MpesaDarajaProvider, StkCallback } from './providers/mpesa-daraja.provider';
import { PaymentProviderAdapter } from './providers/provider';
import { InitiateOutcome } from './models';

const jsonSafe = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly cod: CodProvider,
    private readonly mock: MockProvider,
    private readonly daraja: MpesaDarajaProvider,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Provider registry: real adapter when configured, otherwise the mock. */
  adapterFor(provider: PaymentProvider): { adapter: PaymentProviderAdapter; mock: boolean } {
    if (provider === 'cod') return { adapter: this.cod, mock: false };
    if (provider === 'mpesa' && this.daraja.isConfigured()) return { adapter: this.daraja, mock: false };
    return { adapter: this.mock, mock: true };
  }

  /**
   * Starts payment for a pending order (STK push for M-Pesa). Safe to call again to retry.
   * `payerPhone` defaults to the customer's phone.
   */
  async initiate(orderId: string, payerPhone?: string): Promise<InitiateOutcome> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'pending') throw new DomainError(HttpStatus.CONFLICT, 'order_not_pending', 'This order is not awaiting payment');
    const phone = normalizePhone(payerPhone ?? order.customer.phone);
    if (!phone) throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'invalid_phone', 'Enter a valid Kenyan mobile number');

    const payment = order.payments[0] ?? (await this.prisma.payment.create({ data: { orderId, provider: order.paymentMethod, amount: order.total } }));
    if (payment.status === 'failed') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'pending' } });
    }
    const { adapter, mock } = this.adapterFor(order.paymentMethod);
    const result = await adapter.initiate({
      paymentId: payment.id,
      orderId,
      orderNumber: order.number ?? order.id,
      amount: order.total,
      phone,
    });
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: result.status === 'failed' ? 'failed' : 'pending', providerRef: result.providerRef, raw: jsonSafe(result.raw) },
      }),
      this.prisma.orderEvent.create({
        data: {
          orderId,
          type: result.status === 'failed' ? 'payment:initiate_failed' : 'payment:initiated',
          note: result.message,
          data: { provider: order.paymentMethod, mock },
        },
      }),
    ]);
    return { status: result.status, provider: order.paymentMethod, message: result.message, reference: result.providerRef, mock };
  }

  /** Customer-facing retry: order number + phone must match the order. */
  async initiateForCustomer(orderNumber: string, phone: string): Promise<InitiateOutcome> {
    const norm = normalizePhone(phone);
    const order = await this.prisma.order.findUnique({ where: { number: orderNumber.toUpperCase() }, include: { customer: true } });
    if (!order || !norm || order.customer.phone !== norm) throw new NotFoundException('Order not found');
    if (order.paymentMethod !== 'mpesa') throw new DomainError(HttpStatus.CONFLICT, 'wrong_payment_method', 'This order is not an M-Pesa order');
    return this.initiate(order.id, norm);
  }

  // ------------------------------------------------------------------ Daraja callback
  /** Idempotent: a repeated callback for an already-settled payment is acknowledged and ignored. */
  async handleStkCallback(cb: StkCallback, rawBody: unknown): Promise<{ handled: boolean; reason?: string }> {
    const payment = await this.prisma.payment.findFirst({ where: { provider: 'mpesa', providerRef: cb.CheckoutRequestID }, include: { order: true } });
    if (!payment) {
      this.log.warn(`callback for unknown CheckoutRequestID ${cb.CheckoutRequestID}`);
      return { handled: false, reason: 'unknown_checkout_request' };
    }
    if (payment.status !== 'pending') return { handled: false, reason: 'already_settled' };

    if (cb.ResultCode !== 0) {
      const claimed = await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed', raw: jsonSafe(rawBody) } });
      if (claimed.count === 1) {
        await this.prisma.orderEvent.create({ data: { orderId: payment.orderId, type: 'payment:failed', note: cb.ResultDesc, data: { resultCode: cb.ResultCode } } });
      }
      return { handled: claimed.count === 1 };
    }

    const meta = new Map((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
    const amount = Number(meta.get('Amount') ?? 0);
    const receipt = String(meta.get('MpesaReceiptNumber') ?? '');
    if (amount < payment.amount) {
      await this.prisma.orderEvent.create({
        data: { orderId: payment.orderId, type: 'payment:amount_mismatch', note: `Received ${amount}, expected ${payment.amount}. Needs manual review.`, data: { receipt } },
      });
      return { handled: false, reason: 'amount_mismatch' };
    }
    return this.settle(payment.id, payment.orderId, payment.order.status, { receipt, raw: rawBody });
  }

  private async settle(paymentId: string, orderId: string, orderStatus: string, info: { receipt: string; raw: unknown }) {
    const claimed = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'paid', raw: jsonSafe(info.raw) },
    });
    if (claimed.count !== 1) return { handled: false, reason: 'already_settled' };
    if (orderStatus === 'pending') {
      await this.orders.transition(orderId, 'paid', { label: 'mpesa' }, info.receipt ? `M-Pesa receipt ${info.receipt}` : 'M-Pesa payment confirmed');
    } else {
      // e.g. the reservation expired before the customer paid: flag for staff to refund or reinstate
      await this.prisma.orderEvent.create({
        data: { orderId, type: 'payment:late', note: `Payment received while order was ${orderStatus}. Refund or reinstate manually. Receipt ${info.receipt}` },
      });
    }
    return { handled: true };
  }

  /** Admin: ask Daraja for the real outcome of the latest pending M-Pesa payment (covers missed callbacks). */
  async reconcile(orderId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, provider: 'mpesa', status: 'pending', providerRef: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { order: true },
    });
    if (!payment?.providerRef) throw new DomainError(HttpStatus.CONFLICT, 'nothing_to_reconcile', 'No pending M-Pesa payment with a provider reference');
    if (!this.daraja.isConfigured()) throw new DomainError(HttpStatus.CONFLICT, 'provider_not_configured', 'M-Pesa Daraja credentials are not configured');
    const r = await this.daraja.query(payment.providerRef);
    const code = r.ResultCode === undefined ? undefined : Number(r.ResultCode);
    if (code === 0) {
      const res = await this.settle(payment.id, orderId, payment.order.status, { receipt: '', raw: r });
      return { result: 'paid', ...res };
    }
    if (code === undefined || code === 4999) return { result: 'pending', description: r.ResultDesc };
    await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed', raw: jsonSafe(r) } });
    await this.prisma.orderEvent.create({ data: { orderId, type: 'payment:failed', note: r.ResultDesc ?? 'M-Pesa reported a failure' } });
    return { result: 'failed', description: r.ResultDesc };
  }

  get webhookSecret(): string | undefined {
    return this.cfg.mpesa.callbackSecret;
  }
}
