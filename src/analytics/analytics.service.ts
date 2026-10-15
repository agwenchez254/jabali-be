import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';

/** Orders that count as revenue: payment received or promised-and-in-fulfilment. */
const REVENUE = Prisma.sql`o.status IN ('paid','packed','shipped','delivered')`;
const TZ = 'Africa/Nairobi';

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  private async windowTotals(sinceExpr: Prisma.Sql) {
    const [r] = await this.prisma.$queryRaw<{ revenue: bigint; orders: bigint }[]>`
      SELECT COALESCE(SUM(o.total), 0)::bigint AS revenue, COUNT(*)::bigint AS orders
      FROM orders o WHERE ${REVENUE} AND o."createdAt" >= ${sinceExpr}`;
    return { revenue: n(r?.revenue), orders: n(r?.orders) };
  }

  async summary(days = 30) {
    const startToday = Prisma.sql`(date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ})`;
    const [today, week, month, byStatus, series, top, low, recent] = await Promise.all([
      this.windowTotals(startToday),
      this.windowTotals(Prisma.sql`${startToday} - interval '6 days'`),
      this.windowTotals(Prisma.sql`${startToday} - interval '29 days'`),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.sales(days),
      this.topProducts(5, days),
      this.inventory.lowStock(10),
      this.prisma.order.findMany({ take: 8, orderBy: { createdAt: 'desc' }, include: { customer: true } }),
    ]);
    const statusCounts: Record<string, number> = { pending: 0, paid: 0, packed: 0, shipped: 0, delivered: 0, cancelled: 0, refunded: 0 };
    for (const s of byStatus) statusCounts[s.status] = s._count._all;
    return {
      sales: { today, last7Days: week, last30Days: month },
      ordersByStatus: statusCounts,
      revenueByDay: series,
      topProducts: top,
      lowStock: { count: low.length, items: low },
      recentOrders: recent.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        total: o.total,
        customer: o.customer.name,
        createdAt: o.createdAt,
      })),
    };
  }

  /** Revenue and order count per day (Africa/Nairobi) for the last `days` days, zero-filled. */
  async sales(days = 30) {
    const rows = await this.prisma.$queryRaw<{ day: string; revenue: bigint; orders: bigint }[]>`
      WITH d AS (
        SELECT generate_series(
          (date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${days - 1}::int)),
          date_trunc('day', now() AT TIME ZONE ${TZ}),
          interval '1 day') AS day
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
             COALESCE(SUM(o.total), 0)::bigint AS revenue,
             COUNT(o.id)::bigint AS orders
      FROM d
      LEFT JOIN orders o
        ON ${REVENUE} AND date_trunc('day', o."createdAt" AT TIME ZONE ${TZ}) = d.day
      GROUP BY d.day ORDER BY d.day`;
    return rows.map((r) => ({ date: r.day, revenue: n(r.revenue), orders: n(r.orders) }));
  }

  async topProducts(limit = 5, days = 30) {
    const rows = await this.prisma.$queryRaw<{ productId: string; name: string; units: bigint; revenue: bigint }[]>`
      SELECT l."productId", MAX(l."nameSnapshot") AS name,
             SUM(l.qty)::bigint AS units,
             SUM(l."unitPrice" * l.qty - l."discountAmount")::bigint AS revenue
      FROM order_lines l JOIN orders o ON o.id = l."orderId"
      WHERE ${REVENUE} AND o."createdAt" >= now() - make_interval(days => ${days}::int)
      GROUP BY l."productId" ORDER BY units DESC, revenue DESC LIMIT ${limit}`;
    return rows.map((r) => ({ productId: r.productId, name: r.name, units: n(r.units), revenue: n(r.revenue) }));
  }
}
