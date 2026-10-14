import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Promotion, PromotionTarget } from '@prisma/client';
import { pageArgs, toPage } from '../common/pagination';
import { Db, PrismaService } from '../prisma/prisma.service';
import { PageQueryDto } from '../common/pagination';
import { CreatePromotionDto, PromotionListQuery, UpdatePromotionDto } from './promotions.dto';
import { PricingPromotion } from './pricing/engine';

type PromoRow = Promotion & { targets: PromotionTarget[] };

export type PromotionState = 'draft' | 'paused' | 'scheduled' | 'live' | 'expired';

export function promotionState(p: Pick<Promotion, 'status' | 'startsAt' | 'endsAt'>, now = new Date()): PromotionState {
  if (p.status === 'draft') return 'draft';
  if (p.status === 'paused') return 'paused';
  if (p.endsAt && p.endsAt <= now) return 'expired';
  if (p.startsAt && p.startsAt > now) return 'scheduled';
  return 'live';
}

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  private view(p: PromoRow) {
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      type: p.type,
      value: p.value,
      status: p.status,
      state: promotionState(p),
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      usageLimit: p.usageLimit,
      usedCount: p.usedCount,
      perCustomerLimit: p.perCustomerLimit,
      minSubtotal: p.minSubtotal,
      stackable: p.stackable,
      priority: p.priority,
      targets: p.targets.map((t) => ({ targetType: t.targetType, targetId: t.targetId })),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  async list(q: PromotionListQuery) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.PromotionWhereInput = {
      status: q.status,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.promotion.count({ where }),
      this.prisma.promotion.findMany({ where, skip, take, include: { targets: true }, orderBy: [{ createdAt: 'desc' }] }),
    ]);
    return toPage(rows.map((r) => this.view(r)), total, page, pageSize);
  }

  async get(id: string) {
    const p = await this.prisma.promotion.findUnique({ where: { id }, include: { targets: true } });
    if (!p) throw new NotFoundException('Promotion not found');
    const agg = await this.prisma.promotionRedemption.aggregate({ where: { promotionId: id }, _sum: { amount: true }, _count: true });
    return { ...this.view(p), redemptionCount: agg._count, redeemedAmount: agg._sum.amount ?? 0 };
  }

  static validate(dto: Partial<CreatePromotionDto>): void {
    const { type, value } = dto;
    if (type === 'percent' && value !== undefined && (value < 1 || value > 100)) throw new BadRequestException('percent value must be 1-100');
    if (type === 'fixed' && value !== undefined && value < 1) throw new BadRequestException('fixed value must be at least 1 KES');
    if (type === 'bogo' && value !== undefined && value > 100) throw new BadRequestException('bogo value is a percentage 0-100 (0 = free)');
    if (dto.startsAt && dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt)) throw new BadRequestException('endsAt must be after startsAt');
  }

  async create(dto: CreatePromotionDto) {
    PromotionsService.validate(dto);
    const code = dto.code?.toUpperCase();
    if (code && (await this.prisma.promotion.findUnique({ where: { code } }))) throw new ConflictException(`Code ${code} already exists`);
    const p = await this.prisma.promotion.create({
      data: {
        name: dto.name,
        code,
        type: dto.type,
        value: dto.type === 'free_delivery' ? 0 : dto.value,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        usageLimit: dto.usageLimit ?? null,
        perCustomerLimit: dto.perCustomerLimit ?? null,
        minSubtotal: dto.minSubtotal ?? 0,
        stackable: dto.stackable ?? false,
        priority: dto.priority ?? 0,
        targets: { create: this.targetRows(dto.targets) },
      },
    });
    return this.get(p.id);
  }

  async update(id: string, dto: UpdatePromotionDto) {
    const existing = await this.prisma.promotion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Promotion not found');
    PromotionsService.validate({ ...dto, type: dto.type ?? existing.type, value: dto.value ?? existing.value });
    const code = dto.code?.toUpperCase();
    if (code && code !== existing.code && (await this.prisma.promotion.findUnique({ where: { code } }))) {
      throw new ConflictException(`Code ${code} already exists`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.promotion.update({
        where: { id },
        data: {
          name: dto.name,
          code,
          type: dto.type,
          value: dto.value,
          startsAt: dto.startsAt === undefined ? undefined : dto.startsAt ? new Date(dto.startsAt) : null,
          endsAt: dto.endsAt === undefined ? undefined : dto.endsAt ? new Date(dto.endsAt) : null,
          usageLimit: dto.usageLimit,
          perCustomerLimit: dto.perCustomerLimit,
          minSubtotal: dto.minSubtotal,
          stackable: dto.stackable,
          priority: dto.priority,
        },
      });
      if (dto.targets) {
        await tx.promotionTarget.deleteMany({ where: { promotionId: id } });
        await tx.promotionTarget.createMany({ data: this.targetRows(dto.targets).map((t) => ({ ...t, promotionId: id })) });
      }
    });
    return this.get(id);
  }

  async setStatus(id: string, status: 'active' | 'paused') {
    const res = await this.prisma.promotion.updateMany({ where: { id }, data: { status } });
    if (res.count === 0) throw new NotFoundException('Promotion not found');
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const used = await this.prisma.promotionRedemption.count({ where: { promotionId: id } });
    if (used > 0) throw new ConflictException('Promotion has redemptions; pause it instead of deleting');
    const res = await this.prisma.promotion.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Promotion not found');
  }

  async redemptions(id: string, q: PageQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = { promotionId: id };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.promotionRedemption.count({ where }),
      this.prisma.promotionRedemption.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { order: { select: { id: true, number: true, status: true, total: true } } },
      }),
    ]);
    return toPage(rows, total, page, pageSize);
  }

  private targetRows(targets?: { targetType: 'all' | 'category' | 'product'; targetId?: string }[]) {
    const list = targets && targets.length ? targets : [{ targetType: 'all' as const }];
    return list.map((t) => ({ targetType: t.targetType, targetId: t.targetType === 'all' ? null : (t.targetId ?? null) }));
  }

  // ------------------------------------------------------------ for the pricing engine
  toPricing(p: PromoRow, customerUses = 0): PricingPromotion {
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      type: p.type,
      value: p.value,
      status: p.status,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      usageLimit: p.usageLimit,
      usedCount: p.usedCount,
      perCustomerLimit: p.perCustomerLimit,
      customerUses,
      minSubtotal: p.minSubtotal,
      stackable: p.stackable,
      priority: p.priority,
      targets: p.targets.map((t) => ({ type: t.targetType, id: t.targetId })),
    };
  }

  /** Active automatic promotions + the promotion matching `code` (any status, so the engine can explain why it is rejected). */
  async loadForPricing(db: Db, opts: { code?: string | null; phone?: string | null }): Promise<PricingPromotion[]> {
    const code = opts.code?.trim().toUpperCase();
    const rows = await db.promotion.findMany({
      where: { OR: [{ code: null, status: 'active' }, ...(code ? [{ code }] : [])] },
      include: { targets: true },
    });
    const out: PricingPromotion[] = [];
    for (const r of rows) {
      const uses = opts.phone && r.perCustomerLimit !== null
        ? await db.promotionRedemption.count({ where: { promotionId: r.id, customerRef: opts.phone } })
        : 0;
      out.push(this.toPricing(r, uses));
    }
    return out;
  }
}
