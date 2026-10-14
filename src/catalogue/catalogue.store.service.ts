import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CacheService } from '../common/cache/cache.service';
import { CursorPage, toCursorPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { StoreCategoriesQuery, StoreProductsQuery } from './catalogue.dto';
import { StoreProductCard } from './models';

const cardInclude = {
  category: { select: { id: true, slug: true, label: true } },
  colours: { include: { colour: true }, orderBy: { sortOrder: 'asc' } },
  images: { include: { media: true }, orderBy: { position: 'asc' } },
  variants: { include: { inventory: true } },
} satisfies Prisma.ProductInclude;

type Card = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

const available = (v: { inventory: { onHand: number; reserved: number } | null }) =>
  Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0));

/** Sizes in a sensible order: numeric ascending, clothing sizes by S..XXL, others alphabetical. */
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    const ia = SIZE_ORDER.indexOf(a);
    const ib = SIZE_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    return a.localeCompare(b);
  });
}

@Injectable()
export class CatalogueStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  categories(q: StoreCategoriesQuery) {
    return this.cache.wrap(`store:categories:${q.gender ?? 'all'}`, 300, async () => {
      const rows = await this.prisma.category.findMany({
        where: { gender: q.gender },
        include: { image: true, _count: { select: { products: { where: { status: 'active', deletedAt: null } } } } },
        orderBy: [{ gender: 'asc' }, { sortOrder: 'asc' }],
      });
      return rows.map((c) => ({
        id: c.id,
        gender: c.gender,
        slug: c.slug,
        label: c.label,
        tagline: c.tagline,
        image: c.image?.url ?? null,
        productCount: c._count.products,
      }));
    });
  }

  async list(q: StoreProductsQuery): Promise<CursorPage<StoreProductCard>> {
    const limit = q.limit ?? 24;
    const where: Prisma.ProductWhereInput = {
      status: 'active',
      deletedAt: null,
      gender: q.gender,
      category: q.category ? { slug: q.category } : undefined,
      colours: q.colour ? { some: { colour: { name: { equals: q.colour, mode: 'insensitive' } } } } : undefined,
      variants: q.size ? { some: { size: q.size } } : undefined,
      basePrice: q.min !== undefined || q.max !== undefined ? { gte: q.min, lte: q.max } : undefined,
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { blurb: { contains: q.q, mode: 'insensitive' } },
              { category: { label: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = (() => {
      switch (q.sort) {
        case 'price_asc':
          return [{ basePrice: 'asc' }, { id: 'asc' }];
        case 'price_desc':
          return [{ basePrice: 'desc' }, { id: 'asc' }];
        case 'popular':
          return [{ soldCount: 'desc' }, { id: 'asc' }];
        case 'rating':
          return [{ ratingAvg: 'desc' }, { id: 'asc' }];
        default:
          return [{ createdAt: 'desc' }, { id: 'asc' }];
      }
    })();
    const key = `store:products:${JSON.stringify([q.gender, q.category, q.colour, q.size, q.min, q.max, q.sort, q.q, q.cursor, limit])}`;
    return this.cache.wrap(key, 30, async () => {
      const rows = await this.prisma.product.findMany({
        where,
        orderBy,
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        include: cardInclude,
      });
      const page = toCursorPage(rows, limit);
      return { items: page.items.map((p) => this.toCard(p)), nextCursor: page.nextCursor };
    });
  }

  private toCard(p: Card): StoreProductCard {
    const shared = p.images.find((i) => i.colourId === null);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      gender: p.gender,
      category: p.category,
      price: p.basePrice,
      compareAt: p.compareAtPrice,
      colours: p.colours.map((c) => ({ id: c.colour.id, name: c.colour.name, hex: c.colour.hex })),
      sizes: sortSizes([...new Set(p.variants.map((v) => v.size))]),
      image: (shared ?? p.images[0])?.media.url ?? null,
      isNew: p.isNew,
      isBestseller: p.isBestseller,
      rating: p.ratingAvg,
      sold: p.soldCount,
      inStock: p.variants.some((v) => available(v) > 0),
    };
  }

  async bySlug(slug: string) {
    const p = await this.prisma.product.findFirst({ where: { slug, status: 'active', deletedAt: null }, include: cardInclude });
    if (!p) throw new NotFoundException('Product not found');
    const sharedImages = p.images.filter((i) => i.colourId === null);
    const img = (i: Card['images'][number]) => ({ id: i.id, url: i.media.url, alt: i.alt || i.media.alt || p.name });
    const colours = p.colours.map((pc) => {
      const own = p.images.filter((i) => i.colourId === pc.colourId);
      // per-colour gallery, falling back to the shared one
      const images = (own.length ? own : sharedImages).map(img);
      return { id: pc.colour.id, name: pc.colour.name, hex: pc.colour.hex, images };
    });
    const card = this.toCard(p);
    return {
      ...card,
      blurb: p.blurb,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      images: (sharedImages.length ? sharedImages : p.images).map(img),
      colours,
      variants: p.variants
        .map((v) => ({
          id: v.id,
          sku: v.sku,
          colourId: v.colourId,
          size: v.size,
          price: v.priceOverride ?? p.basePrice,
          available: available(v),
          inStock: available(v) > 0,
          lowStock: v.inventory ? available(v) > 0 && available(v) <= v.inventory.lowStockThreshold : false,
        }))
        .sort((a, b) => sortSizes([a.size, b.size])[0] === a.size ? (a.size === b.size ? 0 : -1) : 1),
    };
  }
}
