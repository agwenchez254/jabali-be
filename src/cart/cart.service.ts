import { Injectable } from '@nestjs/common';
import { DeliveryZone } from '@prisma/client';
import { DeliveryService } from '../delivery/delivery.service';
import { Db, PrismaService } from '../prisma/prisma.service';
import { PricingPromotion, PricingResult, priceCart } from '../promotions/pricing/engine';
import { PromotionsService } from '../promotions/promotions.service';
import { normalizePhone } from '../common/utils';
import { CartQuoteDto, QuoteLineDto } from './cart.dto';
import { CartQuote, CartWarning, PricedCart, ResolvedCart, ResolvedItem } from './models';

/** Used until the admin sets the matching site settings. */
export const DEFAULT_GIFT_FEE = 350;
export const DEFAULT_COD_ZONES = ['nairobi'];

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly promotions: PromotionsService,
  ) {}

  async giftFee(db: Db = this.prisma): Promise<number> {
    const row = await db.siteSetting.findUnique({ where: { key: 'giftFee' } });
    return typeof row?.value === 'number' ? row.value : DEFAULT_GIFT_FEE;
  }

  private async codZones(db: Db): Promise<string[]> {
    const row = await db.siteSetting.findUnique({ where: { key: 'codZoneCodes' } });
    return Array.isArray(row?.value) ? (row.value as unknown[]).filter((c): c is string => typeof c === 'string') : DEFAULT_COD_ZONES;
  }

  /** Merges duplicate variants and loads current price/stock. Unknown or inactive variants become warnings. */
  async resolve(db: Db, lines: QuoteLineDto[]): Promise<ResolvedCart> {
    const merged = new Map<string, QuoteLineDto>();
    for (const l of lines) {
      const prev = merged.get(l.variantId);
      merged.set(l.variantId, prev ? { ...prev, qty: prev.qty + l.qty, gift: l.gift ?? prev.gift } : { ...l });
    }
    const giftFee = await this.giftFee(db);
    const variants = await db.variant.findMany({
      where: { id: { in: [...merged.keys()] } },
      include: {
        colour: true,
        inventory: true,
        product: { include: { images: { include: { media: true }, orderBy: { position: 'asc' } } } },
      },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const items: ResolvedItem[] = [];
    const warnings: CartWarning[] = [];
    for (const [variantId, line] of merged) {
      const v = byId.get(variantId);
      if (!v || v.product.status !== 'active' || v.product.deletedAt) {
        warnings.push({ variantId, type: 'unavailable', message: 'This item is no longer available', available: 0 });
        continue;
      }
      const available = Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0));
      if (available === 0) warnings.push({ variantId, type: 'out_of_stock', message: `${v.product.name} (${v.colour.name}, ${v.size}) is out of stock`, available });
      else if (line.qty > available) {
        warnings.push({ variantId, type: 'insufficient_stock', message: `Only ${available} of ${v.product.name} (${v.colour.name}, ${v.size}) left`, available });
      }
      const ownImage = v.product.images.find((i) => i.colourId === v.colourId) ?? v.product.images.find((i) => i.colourId === null) ?? v.product.images[0];
      items.push({
        variantId,
        productId: v.productId,
        categoryId: v.product.categoryId,
        productName: v.product.name,
        colour: v.colour.name,
        size: v.size,
        sku: v.sku,
        unitPrice: (v.priceOverride ?? v.product.basePrice) + (line.gift ? giftFee : 0),
        qty: line.qty,
        available,
        image: ownImage?.media.url ?? null,
        gift: line.gift ?? null,
      });
    }
    return { items, warnings };
  }

  /** Authoritative pricing. Also used inside the checkout transaction (pass its client as `db`). */
  async price(
    db: Db,
    dto: Pick<CartQuoteDto, 'lines' | 'promoCode' | 'method' | 'county' | 'phone'>,
    opts: { promotions?: PricingPromotion[]; resolved?: ResolvedCart; now?: Date } = {},
  ): Promise<PricedCart> {
    const resolved = opts.resolved ?? (await this.resolve(db, dto.lines));
    const method = dto.method ?? 'delivery';
    let zone: DeliveryZone | null = null;
    let delivery: { fee: number; freeOver: number | null } | null = null;
    if (method === 'delivery' && dto.county) {
      const t = await this.delivery.terms(dto.county, db);
      zone = t.zone;
      delivery = { fee: t.fee, freeOver: t.freeOver };
    }
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    const promotions = opts.promotions ?? (await this.promotions.loadForPricing(db, { code: dto.promoCode, phone }));
    const pricing = priceCart({
      lines: resolved.items.map((i) => ({
        lineId: i.variantId,
        productId: i.productId,
        categoryId: i.categoryId,
        unitPrice: i.unitPrice,
        qty: i.qty,
      })),
      promotions,
      code: dto.promoCode ?? null,
      now: opts.now ?? new Date(),
      delivery,
    });
    const codAllowed = method === 'pickup' || (zone !== null && (await this.codZones(db)).includes(zone.code));
    return { resolved, pricing, zone, method, codAllowed };
  }

  async quote(dto: CartQuoteDto, opts: { promotions?: PricingPromotion[] } = {}): Promise<CartQuote> {
    const priced = await this.price(this.prisma, dto, opts);
    return this.format(priced, dto, await this.giftFee());
  }

  format(priced: PricedCart, dto: Pick<CartQuoteDto, 'county'>, giftFee = DEFAULT_GIFT_FEE): CartQuote {
    const { resolved, pricing, zone, method } = priced;
    const byLine = new Map(pricing.lines.map((l) => [l.lineId, l]));
    return {
      lines: resolved.items.map((i) => {
        const p = byLine.get(i.variantId);
        return {
          variantId: i.variantId,
          productId: i.productId,
          name: i.productName,
          colour: i.colour,
          size: i.size,
          sku: i.sku,
          image: i.image,
          unitPrice: i.unitPrice,
          qty: i.qty,
          lineSubtotal: p?.lineSubtotal ?? i.unitPrice * i.qty,
          discount: p?.discount ?? 0,
          lineTotal: p?.lineTotal ?? i.unitPrice * i.qty,
          available: i.available,
        };
      }),
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      deliveryFee: pricing.deliveryFee,
      total: pricing.total,
      method,
      deliveryPending: method === 'delivery' && !dto.county,
      codAllowed: priced.codAllowed,
      giftFee,
      delivery: zone ? { zone: zone.name, eta: zone.eta, etaDays: zone.etaDays } : null,
      applied: pricing.applied,
      promo: pricing.code,
      warnings: resolved.warnings,
    };
  }
}
