import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { DomainError } from '../common/problem-details.filter';
import { pageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerListQuery } from './customers.dto';

/** Orders that still need work. Delivered, cancelled and refunded orders are finished. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['pending', 'paid', 'packed', 'shipped'];

export type CustomerStatus = 'active' | 'disabled' | 'unverified' | 'guest';

type CustomerRow = Prisma.CustomerGetPayload<{ include: { account: true } }>;

const statusOf = (c: CustomerRow): CustomerStatus => (!c.account ? 'guest' : !c.account.emailVerifiedAt ? 'unverified' : c.account.status);

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private view(c: CustomerRow, stats?: { orders: number; active: number; spent: number }) {
    return {
      id: c.id,
      name: c.account?.displayName || c.name,
      email: c.account?.email ?? c.email,
      phone: c.phone,
      status: statusOf(c),
      hasAccount: !!c.account,
      lastLoginAt: c.account?.lastLoginAt ?? null,
      createdAt: c.createdAt,
      orders: stats?.orders ?? 0,
      activeOrders: stats?.active ?? 0,
      totalSpent: stats?.spent ?? 0,
    };
  }

  private async stats(ids: string[]) {
    const rows = await this.prisma.order.groupBy({
      by: ['customerId', 'status'],
      where: { customerId: { in: ids } },
      _count: { _all: true },
      _sum: { total: true },
    });
    const out = new Map<string, { orders: number; active: number; spent: number }>();
    for (const r of rows) {
      const s = out.get(r.customerId) ?? { orders: 0, active: 0, spent: 0 };
      s.orders += r._count._all;
      if (ACTIVE_ORDER_STATUSES.includes(r.status)) s.active += r._count._all;
      if (r.status === 'delivered') s.spent += r._sum.total ?? 0;
      out.set(r.customerId, s);
    }
    return out;
  }

  async list(q: CustomerListQuery) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const status: Prisma.CustomerWhereInput =
      q.status === 'guest'
        ? { account: { is: null } }
        : q.status === 'unverified'
          ? { account: { is: { emailVerifiedAt: null } } }
          : q.status
            ? { account: { is: { status: q.status, emailVerifiedAt: { not: null } } } }
            : {};
    const where: Prisma.CustomerWhereInput = {
      ...status,
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              { phone: { contains: q.q.replace(/\s/g, '') } },
              { account: { is: { email: { contains: q.q, mode: 'insensitive' } } } },
              { account: { is: { displayName: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({ where, skip, take, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], include: { account: true } }),
    ]);
    const stats = await this.stats(rows.map((r) => r.id));
    return toPage(
      rows.map((r) => this.view(r, stats.get(r.id))),
      total,
      page,
      pageSize,
    );
  }

  async get(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id }, include: { account: true } });
    if (!c) throw new NotFoundException('Customer not found');
    const stats = await this.stats([id]);
    const recent = await this.prisma.order.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, number: true, status: true, total: true, createdAt: true },
    });
    const addresses = c.account
      ? await this.prisma.customerAddress.findMany({ where: { accountId: c.account.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true, label: true, county: true, area: true, street: true, recipient: true, phone: true, isDefault: true } })
      : [];
    return { ...this.view(c, stats.get(id)), addresses, orderList: recent.map((o) => ({ ...o, active: ACTIVE_ORDER_STATUSES.includes(o.status) })) };
  }

  /** Blocked while the customer has an order that still needs work: that order has to be cancelled or completed first. */
  async deactivate(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id }, include: { account: true } });
    if (!c) throw new NotFoundException('Customer not found');
    if (!c.account) throw new DomainError(HttpStatus.CONFLICT, 'no_account', 'This customer has no account to deactivate.');
    const accountId = c.account.id;
    await this.prisma.$transaction(
      async (tx) => {
        const active = await tx.order.findMany({
          where: { customerId: id, status: { in: ACTIVE_ORDER_STATUSES } },
          select: { id: true, number: true, status: true },
          orderBy: { createdAt: 'asc' },
        });
        if (active.length > 0) {
          const n = active.length;
          throw new DomainError(HttpStatus.CONFLICT, 'active_orders', `This customer has ${n} active order${n === 1 ? '' : 's'}. Cancel or complete ${n === 1 ? 'it' : 'them'} first.`, { orders: active });
        }
        await tx.customerAccount.update({ where: { id: accountId }, data: { status: 'disabled' } });
        await tx.customerRefreshToken.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: new Date() } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.get(id);
  }

  async activate(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id }, include: { account: true } });
    if (!c) throw new NotFoundException('Customer not found');
    if (!c.account) throw new DomainError(HttpStatus.CONFLICT, 'no_account', 'This customer has no account.');
    await this.prisma.customerAccount.update({ where: { id: c.account.id }, data: { status: 'active', failedLogins: 0, lockedUntil: null } });
    return this.get(id);
  }
}
