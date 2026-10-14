import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MovementReason, Prisma } from '@prisma/client';
import { Page, pageArgs, toPage } from '../common/pagination';
import { Db, PrismaService } from '../prisma/prisma.service';
import { AdjustInventoryDto, InventoryListQuery, MovementsQuery, UpdateThresholdDto } from './inventory.dto';

/** Row-level helpers shared with the orders module. Always call inside a transaction. */
export async function lockInventory(tx: Db, variantIds: string[]): Promise<void> {
  if (variantIds.length === 0) return;
  const ids = [...new Set(variantIds)].sort(); // consistent order => no deadlocks
  await tx.$queryRaw`SELECT "variantId" FROM "inventory" WHERE "variantId" = ANY(${ids}::uuid[]) ORDER BY "variantId" FOR UPDATE`;
}

const rowInclude = {
  inventory: true,
  colour: true,
  product: { select: { id: true, name: true, slug: true, status: true } },
} satisfies Prisma.VariantInclude;

type Row = Prisma.VariantGetPayload<{ include: typeof rowInclude }>;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private toRow(v: Row) {
    const onHand = v.inventory?.onHand ?? 0;
    const reserved = v.inventory?.reserved ?? 0;
    const threshold = v.inventory?.lowStockThreshold ?? 0;
    return {
      variantId: v.id,
      sku: v.sku,
      productId: v.product.id,
      productName: v.product.name,
      productSlug: v.product.slug,
      colour: v.colour.name,
      size: v.size,
      onHand,
      reserved,
      available: onHand - reserved,
      lowStockThreshold: threshold,
      low: onHand - reserved <= threshold,
    };
  }

  async list(q: InventoryListQuery): Promise<Page<ReturnType<InventoryService['toRow']>>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const base: Prisma.VariantWhereInput = {
      product: { deletedAt: null, ...(q.productId ? { id: q.productId } : {}) },
      ...(q.q
        ? {
            OR: [
              { sku: { contains: q.q, mode: 'insensitive' } },
              { product: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    if (q.low) {
      const ids = await this.lowVariantIds();
      base.id = { in: ids };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.variant.count({ where: base }),
      this.prisma.variant.findMany({ where: base, include: rowInclude, skip, take, orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }] }),
    ]);
    return toPage(rows.map((r) => this.toRow(r)), total, page, pageSize);
  }

  private async lowVariantIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ variantId: string }[]>`
      SELECT i."variantId" FROM inventory i JOIN variants v ON v.id = i."variantId" JOIN products p ON p.id = v."productId"
      WHERE p."deletedAt" IS NULL AND (i."onHand" - i."reserved") <= i."lowStockThreshold"`;
    return rows.map((r) => r.variantId);
  }

  async lowStock(limit = 50) {
    const ids = await this.lowVariantIds();
    const rows = await this.prisma.variant.findMany({ where: { id: { in: ids } }, include: rowInclude, take: limit });
    return rows.map((r) => this.toRow(r)).sort((a, b) => a.available - b.available);
  }

  /**
   * Adjusts stock by `delta` (or sets it with `setTo`) under a row lock and records a movement.
   * Rejects anything that would drop on-hand below what is reserved.
   */
  async adjust(dto: AdjustInventoryDto, actorId?: string) {
    if ((dto.delta === undefined) === (dto.setTo === undefined)) {
      throw new BadRequestException('Provide exactly one of delta or setTo');
    }
    await this.prisma.$transaction(async (tx) => {
      const variant = await tx.variant.findUnique({ where: { id: dto.variantId } });
      if (!variant) throw new NotFoundException('Variant not found');
      await tx.inventory.upsert({ where: { variantId: dto.variantId }, update: {}, create: { variantId: dto.variantId } });
      await lockInventory(tx, [dto.variantId]);
      const inv = await tx.inventory.findUniqueOrThrow({ where: { variantId: dto.variantId } });
      const delta = dto.delta ?? (dto.setTo as number) - inv.onHand;
      if (delta === 0) return inv;
      const next = inv.onHand + delta;
      if (next < inv.reserved) {
        throw new ConflictException(`Cannot reduce on-hand below reserved units (${inv.reserved} reserved)`);
      }
      const updated = await tx.inventory.update({ where: { variantId: dto.variantId }, data: { onHand: next } });
      await tx.inventoryMovement.create({
        data: { variantId: dto.variantId, delta, reason: dto.reason as MovementReason, note: dto.note, actorId, ref: dto.ref },
      });
      return updated;
    });
    return this.rowFor(dto.variantId);
  }

  private async rowFor(variantId: string) {
    const v = await this.prisma.variant.findUniqueOrThrow({ where: { id: variantId }, include: rowInclude });
    return this.toRow(v);
  }

  async updateThreshold(variantId: string, dto: UpdateThresholdDto) {
    await this.prisma.inventory.upsert({
      where: { variantId },
      update: { lowStockThreshold: dto.lowStockThreshold },
      create: { variantId, lowStockThreshold: dto.lowStockThreshold },
    });
    return this.rowFor(variantId);
  }

  async movements(variantId: string, q: MovementsQuery) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = { variantId };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    ]);
    return toPage(items, total, page, pageSize);
  }
}
