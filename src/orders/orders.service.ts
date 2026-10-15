import { HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Inject } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { CartService } from '../cart/cart.service';
import { DomainError } from '../common/problem-details.filter';
import { CacheService } from '../common/cache/cache.service';
import { StoreEventsService } from '../store-events/store-events.service';
import { pageArgs, toPage } from '../common/pagination';
import { formatOrderNumber, isUniqueViolation, normalizePhone } from '../common/utils';
import { APP_CONFIG, AppConfig } from '../config/config';
import { lockInventory } from '../inventory/inventory.service';
import { Db, PrismaService } from '../prisma/prisma.service';
import { AdminOrderListQuery, CheckoutDto } from './orders.dto';
import { Actor } from './models';
import { allowedTransitions, canTransition } from './state-machine';
import { vatFor, vatView } from './vat';

const RESERVATION_MINUTES = 30;
/** Order events a customer may see on their timeline. */
const CUSTOMER_EVENTS = new Set(['created', 'status:paid', 'status:packed', 'status:shipped', 'status:delivered', 'status:cancelled', 'status:refunded']);

const orderInclude = {
  customer: true,
  lines: true,
  payments: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Orders');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly cache: CacheService,
    private readonly events: StoreEventsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.enableScheduler) return;
    // cancels unpaid, non-COD orders whose stock reservation has expired
    this.timer = setInterval(() => void this.expireStale().catch((e: unknown) => this.log.error(String(e))), 60_000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ views
  view(o: OrderFull) {
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      method: o.method,
      paymentMethod: o.paymentMethod,
      subtotal: o.subtotal,
      discount: o.discount,
      deliveryFee: o.deliveryFee,
      total: o.total,
      county: o.county,
      address: o.address,
      eta: o.eta,
      notes: o.notes,
      vat: vatView(o),
      stockCommitted: o.stockCommitted,
      reservationExpiresAt: o.reservationExpiresAt,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      allowedTransitions: allowedTransitions(o.status, o.paymentMethod),
      customer: { id: o.customer.id, name: o.customer.name, phone: o.customer.phone, email: o.customer.email },
      lines: o.lines.map((l) => ({
        id: l.id,
        variantId: l.variantId,
        productId: l.productId,
        name: l.nameSnapshot,
        colour: l.colourSnapshot,
        size: l.size,
        sku: l.skuSnapshot,
        unitPrice: l.unitPrice,
        qty: l.qty,
        discount: l.discountAmount,
        lineTotal: l.unitPrice * l.qty - l.discountAmount,
        gift: l.gift,
      })),
      payments: o.payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        status: p.status,
        amount: p.amount,
        providerRef: p.providerRef,
        createdAt: p.createdAt,
      })),
      events: o.events.map((e) => ({ id: e.id, type: e.type, note: e.note, data: e.data, actorId: e.actorId, createdAt: e.createdAt })),
      /** True when any line carries gift options: packing slips must hide prices. */
      isGift: o.lines.some((l) => l.gift !== null),
    };
  }

  // ------------------------------------------------------------------ checkout
  async checkout(dto: CheckoutDto, idempotencyKey: string, customerId: string): Promise<{ order: ReturnType<OrdersService['view']>; created: boolean }> {
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey }, include: orderInclude });
    if (existing) return { order: this.ownedReplay(existing, customerId), created: false };

    try {
      const id = await this.prisma.$transaction(
        async (tx) => this.createOrderTx(tx, dto, customerId, idempotencyKey),
        { maxWait: 10_000, timeout: 20_000 },
      );
      void this.cache.invalidate('store:products').then(() => this.events.emit(['Product', 'Home']));
      const order = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
      return { order: this.view(order), created: true };
    } catch (e) {
      if (isUniqueViolation(e)) {
        const dup = await this.prisma.order.findUnique({ where: { idempotencyKey }, include: orderInclude });
        if (dup) return { order: this.ownedReplay(dup, customerId), created: false };
      }
      throw e;
    }
  }

  /** A replayed Idempotency-Key may only return the caller's own order. */
  private ownedReplay(order: OrderFull, customerId: string) {
    if (order.customerId !== customerId) {
      throw new DomainError(HttpStatus.CONFLICT, 'idempotency_key_conflict', 'This Idempotency-Key was already used. Send a new one.');
    }
    return this.view(order);
  }

  private async createOrderTx(tx: Prisma.TransactionClient, dto: CheckoutDto, customerId: string, idempotencyKey: string): Promise<string> {
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    const phone = customer.phone;
    // 1. lock inventory rows in a consistent order, so concurrent buyers serialise per variant
    await lockInventory(tx, dto.lines.map((l) => l.variantId));

    // 2. re-price from current data using the same engine as /store/cart/quote
    const priced = await this.cart.price(tx, { lines: dto.lines, promoCode: dto.promoCode, method: dto.method, county: dto.county, phone });
    const { resolved, pricing, zone } = priced;
    if (dto.paymentMethod === 'cod' && !priced.codAllowed) {
      throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'cod_not_available', 'Pay on delivery is not available for this order');
    }
    if (dto.method === 'delivery' && !zone) throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'county_required', 'A delivery county is required');
    if (resolved.items.length === 0 || resolved.warnings.length > 0) {
      throw new DomainError(HttpStatus.CONFLICT, 'insufficient_stock', 'Some items are no longer available in the requested quantity', {
        shortages: resolved.warnings,
      });
    }
    if (pricing.code && !pricing.code.valid) {
      throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'invalid_promo', `Promo code cannot be applied: ${pricing.code.reason}`, {
        reason: pricing.code.reason,
      });
    }

    // 3. reserve stock (row locks are held, CHECK constraints guard the invariants)
    for (const item of resolved.items) {
      await tx.inventory.update({ where: { variantId: item.variantId }, data: { reserved: { increment: item.qty } } });
    }

    const pickupAddress = await tx.siteSetting.findUnique({ where: { key: 'pickupAddress' } });
    const vat = await vatFor(tx, pricing.total);
    const byLine = new Map(pricing.lines.map((l) => [l.lineId, l]));
    const order = await tx.order.create({
      data: {
        customerId: customer.id,
        method: dto.method,
        subtotal: pricing.subtotal,
        discount: pricing.discount,
        deliveryFee: pricing.deliveryFee,
        total: pricing.total,
        paymentMethod: dto.paymentMethod,
        county: dto.method === 'delivery' ? zone?.counties.find((c) => c.toLowerCase() === dto.county?.trim().toLowerCase()) ?? dto.county : null,
        address: dto.method === 'delivery' ? dto.address : typeof pickupAddress?.value === 'string' ? pickupAddress.value : 'Store pickup',
        eta: zone?.eta ?? null,
        notes: dto.notes,
        ...(vat ? { vatRateBp: vat.rateBp, vatAmount: vat.amount, vatSeller: vat.seller } : {}),
        idempotencyKey,
        reservationExpiresAt: dto.paymentMethod === 'cod' ? null : new Date(Date.now() + RESERVATION_MINUTES * 60_000),
        lines: {
          create: resolved.items.map((i) => ({
            variantId: i.variantId,
            productId: i.productId,
            nameSnapshot: i.productName,
            colourSnapshot: i.colour,
            skuSnapshot: i.sku,
            size: i.size,
            unitPrice: i.unitPrice,
            qty: i.qty,
            discountAmount: byLine.get(i.variantId)?.discount ?? 0,
            gift: (i.gift as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
          })),
        },
        payments: { create: { provider: dto.paymentMethod, amount: pricing.total, status: 'pending' } },
        events: { create: { type: 'created', note: `Order placed (${dto.paymentMethod})` } },
      },
    });
    const numbered = await tx.order.update({ where: { id: order.id }, data: { number: formatOrderNumber(order.seq) } });

    // 4. promotion redemptions (usage limit enforced atomically)
    for (const a of pricing.applied) {
      const bumped = await tx.$executeRaw`
        UPDATE "promotions" SET "usedCount" = "usedCount" + 1
        WHERE id = ${a.promotionId}::uuid AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
      if (bumped === 0) {
        throw new DomainError(HttpStatus.CONFLICT, 'promo_exhausted', 'This promotion has just reached its usage limit');
      }
      await tx.promotionRedemption.create({ data: { promotionId: a.promotionId, orderId: numbered.id, customerRef: phone, amount: a.amount } });
    }
    return numbered.id;
  }

  // ------------------------------------------------------------------ reads
  async list(q: AdminOrderListQuery) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.OrderWhereInput = {
      status: q.status,
      method: q.method,
      paymentMethod: q.paymentMethod,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: 'insensitive' } },
              { customer: { name: { contains: q.q, mode: 'insensitive' } } },
              { customer: { phone: { contains: q.q.replace(/\s/g, '') } } },
              { customer: { email: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: { customer: true, _count: { select: { lines: true } } },
      }),
    ]);
    return toPage(
      rows.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        method: o.method,
        paymentMethod: o.paymentMethod,
        customer: { name: o.customer.name, phone: o.customer.phone },
        lineCount: o._count.lines,
        total: o.total,
        county: o.county,
        createdAt: o.createdAt,
      })),
      total,
      page,
      pageSize,
    );
  }

  /** The customer's own orders, newest first. */
  async listForCustomer(customerId: string, page: number, limit: number) {
    const where = { customerId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: { _count: { select: { lines: true } }, payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
    ]);
    const items = rows.map((o) => ({
      number: o.number,
      status: o.status,
      paymentStatus: o.payments[0]?.status ?? 'pending',
      method: o.method,
      paymentMethod: o.paymentMethod,
      total: o.total,
      lineCount: o._count.lines,
      createdAt: o.createdAt,
    }));
    return { items, total, page, limit };
  }

  /**
   * One of the customer's own orders, for the order page and the receipt. Shows the account's name and email
   * (never those of a linked guest record) and none of the staff-only fields.
   */
  async detailForCustomer(me: { customerId: string; name: string; email: string }, number: string) {
    const o = await this.prisma.order.findFirst({ where: { number: number.toUpperCase(), customerId: me.customerId }, include: orderInclude });
    if (!o) throw new NotFoundException('Order not found');
    return {
      number: o.number,
      status: o.status,
      method: o.method,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.payments[o.payments.length - 1]?.status ?? 'pending',
      createdAt: o.createdAt,
      eta: o.eta,
      county: o.county,
      address: o.address,
      notes: o.notes,
      contactName: o.contactName,
      contactPhone: o.contactPhone,
      subtotal: o.subtotal,
      discount: o.discount,
      deliveryFee: o.deliveryFee,
      total: o.total,
      vat: vatView(o),
      customer: { name: me.name, email: me.email, phone: o.customer.phone },
      lines: o.lines.map((l) => ({
        id: l.id,
        name: l.nameSnapshot,
        colour: l.colourSnapshot,
        size: l.size,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discount: l.discountAmount,
        lineTotal: l.unitPrice * l.qty - l.discountAmount,
        giftTo: typeof (l.gift as { to?: unknown } | null)?.to === 'string' ? (l.gift as { to: string }).to : l.gift ? '' : undefined,
      })),
      payments: o.payments.map((p) => ({ provider: p.provider, status: p.status, amount: p.amount, payerPhone: p.payerPhone, createdAt: p.createdAt })),
      timeline: o.events.filter((e) => CUSTOMER_EVENTS.has(e.type)).map((e) => ({ type: e.type.replace('status:', ''), at: e.createdAt })),
    };
  }

  async get(id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!o) throw new NotFoundException('Order not found');
    return this.view(o);
  }

  async exportCsv(q: AdminOrderListQuery): Promise<string> {
    const page = await this.list({ ...q, page: 1, pageSize: 100 });
    const rows = [...page.items];
    for (let p = 2; p <= Math.min(page.pageCount, 100); p++) rows.push(...(await this.list({ ...q, page: p, pageSize: 100 })).items);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['number', 'created_at', 'status', 'customer', 'phone', 'method', 'payment', 'county', 'total_kes'];
    const lines = rows.map((r) =>
      [r.number, r.createdAt.toISOString(), r.status, r.customer.name, r.customer.phone, r.method, r.paymentMethod, r.county, r.total].map(esc).join(','),
    );
    return [head.join(','), ...lines].join('\r\n');
  }

  /** Customer-facing tracking: number + phone must match. */
  async track(number: string, rawPhone: string) {
    const phone = normalizePhone(rawPhone);
    const o = phone ? await this.prisma.order.findUnique({ where: { number: number.toUpperCase() }, include: orderInclude }) : null;
    if (!o || o.customer.phone !== phone) throw new NotFoundException('Order not found');
    const customerEvents = new Set(['created', 'status:paid', 'status:packed', 'status:shipped', 'status:delivered', 'status:cancelled', 'status:refunded']);
    return {
      number: o.number,
      status: o.status,
      method: o.method,
      eta: o.eta,
      county: o.county,
      createdAt: o.createdAt,
      subtotal: o.subtotal,
      discount: o.discount,
      deliveryFee: o.deliveryFee,
      total: o.total,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.payments[o.payments.length - 1]?.status ?? 'pending',
      lines: o.lines.map((l) => ({ name: l.nameSnapshot, colour: l.colourSnapshot, size: l.size, qty: l.qty, unitPrice: l.unitPrice })),
      timeline: o.events.filter((e) => customerEvents.has(e.type)).map((e) => ({ type: e.type.replace('status:', ''), at: e.createdAt })),
    };
  }

  // ------------------------------------------------------------------ transitions
  async transition(id: string, to: OrderStatus, actor: Actor, note?: string) {
    await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "orders" WHERE id = ${id}::uuid FOR UPDATE`;
        if (locked.length === 0) throw new NotFoundException('Order not found');
        const order = await tx.order.findUniqueOrThrow({ where: { id }, include: { lines: true, payments: true } });
        if (!canTransition(order.status, to, order.paymentMethod)) {
          throw new DomainError(HttpStatus.CONFLICT, 'invalid_transition', `Cannot move an order from ${order.status} to ${to}`, {
            allowed: allowedTransitions(order.status, order.paymentMethod),
          });
        }
        await lockInventory(tx, order.lines.map((l) => l.variantId));
        const label = order.number ?? order.id;

        // stock + payment side effects
        if ((to === 'paid' || to === 'shipped') && !order.stockCommitted) {
          await this.commitStock(tx, order, label);
        }
        if (to === 'paid') {
          await tx.payment.updateMany({ where: { orderId: id, status: 'pending' }, data: { status: 'paid' } });
        }
        if (to === 'delivered' && order.paymentMethod === 'cod') {
          await tx.payment.updateMany({ where: { orderId: id, status: 'pending' }, data: { status: 'paid' } });
        }
        if (to === 'cancelled') {
          await this.releaseStock(tx, order, label);
          await this.revertRedemptions(tx, id);
          await tx.payment.updateMany({ where: { orderId: id, status: 'pending' }, data: { status: 'failed' } });
          await tx.payment.updateMany({ where: { orderId: id, status: 'paid' }, data: { status: 'refunded' } });
        }
        if (to === 'refunded') {
          if (order.status === 'paid') {
            await this.releaseStock(tx, order, label);
            await this.revertRedemptions(tx, id);
          }
          await tx.payment.updateMany({ where: { orderId: id, status: 'paid' }, data: { status: 'refunded' } });
        }

        await tx.order.update({
          where: { id },
          data: { status: to, reservationExpiresAt: to === 'pending' ? undefined : null },
        });
        await tx.orderEvent.create({
          data: {
            orderId: id,
            type: `status:${to}`,
            actorId: actor.id ?? null,
            note: note ?? null,
            data: { from: order.status, to, ...(actor.label ? { by: actor.label } : {}) },
          },
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    void this.cache.invalidate('store:products').then(() => this.events.emit(['Product', 'Home']));
    return this.get(id);
  }

  /** on_hand and reserved both drop; the sale is recorded as a movement. */
  private async commitStock(tx: Db, order: { id: string; lines: { variantId: string; productId: string; qty: number }[] }, ref: string) {
    for (const l of order.lines) {
      await tx.inventory.update({ where: { variantId: l.variantId }, data: { onHand: { decrement: l.qty }, reserved: { decrement: l.qty } } });
      await tx.inventoryMovement.create({ data: { variantId: l.variantId, delta: -l.qty, reason: 'sale', ref } });
      await tx.product.update({ where: { id: l.productId }, data: { soldCount: { increment: l.qty } } });
    }
    await tx.order.update({ where: { id: order.id }, data: { stockCommitted: true } });
  }

  /** Not yet sold: free the reservation. Already sold: put the units back on the shelf. */
  private async releaseStock(tx: Db, order: { id: string; stockCommitted: boolean; lines: { variantId: string; productId: string; qty: number }[] }, ref: string) {
    for (const l of order.lines) {
      if (order.stockCommitted) {
        await tx.inventory.update({ where: { variantId: l.variantId }, data: { onHand: { increment: l.qty } } });
        await tx.inventoryMovement.create({ data: { variantId: l.variantId, delta: l.qty, reason: 'return', ref } });
        await tx.product.update({ where: { id: l.productId }, data: { soldCount: { decrement: l.qty } } });
      } else {
        await tx.inventory.update({ where: { variantId: l.variantId }, data: { reserved: { decrement: l.qty } } });
      }
    }
    if (order.stockCommitted) await tx.order.update({ where: { id: order.id }, data: { stockCommitted: false } });
  }

  private async revertRedemptions(tx: Db, orderId: string) {
    const reds = await tx.promotionRedemption.findMany({ where: { orderId } });
    for (const r of reds) {
      await tx.$executeRaw`UPDATE "promotions" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE id = ${r.promotionId}::uuid`;
    }
    await tx.promotionRedemption.deleteMany({ where: { orderId } });
  }

  /** Cancels unpaid online-payment orders whose reservation window has passed. Returns how many were cancelled. */
  async expireStale(now = new Date()): Promise<number> {
    const stale = await this.prisma.order.findMany({
      where: { status: 'pending', paymentMethod: { not: 'cod' }, reservationExpiresAt: { lt: now } },
      select: { id: true },
      take: 100,
    });
    let n = 0;
    for (const o of stale) {
      try {
        await this.transition(o.id, 'cancelled', { label: 'system:reservation-expired' }, 'Payment not received in time');
        n++;
      } catch (e) {
        this.log.warn(`could not expire order ${o.id}: ${String(e)}`);
      }
    }
    return n;
  }
}
