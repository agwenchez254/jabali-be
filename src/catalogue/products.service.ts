import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, pageArgs, toPage } from '../common/pagination';
import { slugify, uniqueSlug } from '../common/utils';
import { Db, PrismaService } from '../prisma/prisma.service';
import {
  AdminProductListQuery,
  BulkProductsDto,
  CreateProductDto,
  CreateVariantDto,
  SetProductImagesDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './catalogue.dto';

const detailInclude = {
  category: { select: { id: true, slug: true, label: true, gender: true } },
  colours: { include: { colour: true }, orderBy: { sortOrder: 'asc' } },
  images: { include: { media: true }, orderBy: [{ position: 'asc' }] },
  variants: { include: { colour: true, inventory: true }, orderBy: [{ colourId: 'asc' }, { size: 'asc' }] },
} satisfies Prisma.ProductInclude;

type ProductDetail = Prisma.ProductGetPayload<{ include: typeof detailInclude }>;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- reads
  async list(q: AdminProductListQuery): Promise<Page<ReturnType<ProductsService['toListItem']>>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: q.status,
      gender: q.gender,
      categoryId: q.categoryId,
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { slug: { contains: q.q, mode: 'insensitive' } },
              { variants: { some: { sku: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    if (q.stock === 'out') where.variants = { none: { inventory: { is: { onHand: { gt: 0 } } } } };
    if (q.stock === 'in') where.variants = { some: { inventory: { is: { onHand: { gt: 0 } } } } };
    if (q.stock === 'low') {
      const lowIds = await this.prisma.$queryRaw<{ productId: string }[]>`
        SELECT DISTINCT v."productId" FROM variants v JOIN inventory i ON i."variantId" = v.id
        WHERE (i."onHand" - i."reserved") <= i."lowStockThreshold"`;
      where.id = { in: lowIds.map((r) => r.productId) };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        include: {
          category: { select: { id: true, slug: true, label: true } },
          images: { include: { media: true }, orderBy: { position: 'asc' }, take: 1 },
          variants: { include: { inventory: true } },
          _count: { select: { variants: true } },
        },
      }),
    ]);
    return toPage(rows.map((r) => this.toListItem(r)), total, page, pageSize);
  }

  private toListItem(
    p: Prisma.ProductGetPayload<{
      include: {
        category: { select: { id: true; slug: true; label: true } };
        images: { include: { media: true } };
        variants: { include: { inventory: true } };
        _count: { select: { variants: true } };
      };
    }>,
  ) {
    const onHand = p.variants.reduce((a, v) => a + (v.inventory?.onHand ?? 0), 0);
    const available = p.variants.reduce((a, v) => a + Math.max(0, (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0)), 0);
    const lowStock = p.variants.some((v) => v.inventory && v.inventory.onHand - v.inventory.reserved <= v.inventory.lowStockThreshold);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      gender: p.gender,
      category: p.category,
      basePrice: p.basePrice,
      compareAtPrice: p.compareAtPrice,
      status: p.status,
      isNew: p.isNew,
      isBestseller: p.isBestseller,
      soldCount: p.soldCount,
      image: p.images[0]?.media.url ?? null,
      variantCount: p._count.variants,
      stock: { onHand, available, lowStock },
      updatedAt: p.updatedAt,
    };
  }

  async get(id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: detailInclude });
    if (!p) throw new NotFoundException('Product not found');
    return this.toDetail(p);
  }

  private toDetail(p: ProductDetail) {
    const colours = p.colours.map((pc) => ({ id: pc.colour.id, name: pc.colour.name, hex: pc.colour.hex, sortOrder: pc.sortOrder }));
    const images = p.images.map((i) => ({
      id: i.id,
      mediaId: i.mediaId,
      url: i.media.url,
      alt: i.alt || i.media.alt,
      colourId: i.colourId,
      position: i.position,
    }));
    const hasShared = images.some((i) => i.colourId === null);
    const warnings = colours
      .filter((c) => !images.some((i) => i.colourId === c.id) && !hasShared)
      .map((c) => `No images for colour ${c.name}`);
    if (p.status === 'active' && images.length === 0) warnings.push('Active product has no images');
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      gender: p.gender,
      category: p.category,
      blurb: p.blurb,
      basePrice: p.basePrice,
      compareAtPrice: p.compareAtPrice,
      status: p.status,
      isNew: p.isNew,
      isBestseller: p.isBestseller,
      ratingAvg: p.ratingAvg,
      soldCount: p.soldCount,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      colours,
      images,
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        colourId: v.colourId,
        colourName: v.colour.name,
        size: v.size,
        priceOverride: v.priceOverride,
        barcode: v.barcode,
        onHand: v.inventory?.onHand ?? 0,
        reserved: v.inventory?.reserved ?? 0,
        available: (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0),
        lowStockThreshold: v.inventory?.lowStockThreshold ?? 0,
      })),
      warnings,
    };
  }

  // ---------------------------------------------------------------- writes
  async create(dto: CreateProductDto) {
    await this.assertCategory(dto.categoryId, dto.gender);
    const colourIds = [...new Set(dto.colourIds ?? [])];
    await this.assertColours(colourIds);
    if ((dto.sizes?.length ?? 0) > 0 && colourIds.length === 0) {
      throw new BadRequestException('sizes requires colourIds to generate the variant grid');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const slug = dto.slug
        ? await this.assertSlugFree(tx, dto.slug)
        : await uniqueSlug(dto.name, async (s) => !!(await tx.product.findUnique({ where: { slug: s } })));
      const product = await tx.product.create({
        data: {
          slug,
          name: dto.name,
          gender: dto.gender,
          categoryId: dto.categoryId,
          blurb: dto.blurb ?? '',
          basePrice: dto.basePrice,
          compareAtPrice: dto.compareAtPrice ?? null,
          status: dto.status ?? 'draft',
          isNew: dto.isNew ?? false,
          isBestseller: dto.isBestseller ?? false,
          seoTitle: dto.seoTitle,
          seoDescription: dto.seoDescription,
          colours: { create: colourIds.map((colourId, sortOrder) => ({ colourId, sortOrder })) },
        },
      });
      const sizes = [...new Set(dto.sizes ?? [])];
      for (const colourId of colourIds) {
        for (const size of sizes) {
          await this.createVariant(tx, product.id, product.slug, { colourId, size, initialStock: dto.initialStock });
        }
      }
      return product.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Product not found');
    if (dto.categoryId || dto.gender) await this.assertCategory(dto.categoryId ?? existing.categoryId, dto.gender ?? existing.gender);
    if (dto.colourIds) await this.assertColours(dto.colourIds);
    await this.prisma.$transaction(async (tx) => {
      if (dto.slug && dto.slug !== existing.slug) await this.assertSlugFree(tx, dto.slug);
      const { colourIds, ...fields } = dto;
      await tx.product.update({ where: { id }, data: fields });
      if (colourIds) {
        const unique = [...new Set(colourIds)];
        const removed = await tx.productColour.findMany({ where: { productId: id, colourId: { notIn: unique } } });
        if (removed.length) {
          const blocking = await tx.variant.count({ where: { productId: id, colourId: { in: removed.map((r) => r.colourId) } } });
          if (blocking > 0) throw new ConflictException('Delete the variants of a colour before removing it from the product');
          await tx.productImage.deleteMany({ where: { productId: id, colourId: { in: removed.map((r) => r.colourId) } } });
          await tx.productColour.deleteMany({ where: { productId: id, colourId: { in: removed.map((r) => r.colourId) } } });
        }
        for (const [sortOrder, colourId] of unique.entries()) {
          await tx.productColour.upsert({
            where: { productId_colourId: { productId: id, colourId } },
            update: { sortOrder },
            create: { productId: id, colourId, sortOrder },
          });
        }
      }
    });
    return this.get(id);
  }

  /** Soft delete: archived and hidden from every listing, but order history stays intact. */
  async remove(id: string): Promise<void> {
    const res = await this.prisma.product.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), status: 'archived' },
    });
    if (res.count === 0) throw new NotFoundException('Product not found');
  }

  async bulk(dto: BulkProductsDto) {
    if (dto.status === undefined && dto.pricePercent === undefined && dto.categoryId === undefined) {
      throw new BadRequestException('Provide at least one of status, pricePercent, categoryId');
    }
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    const ids = [...new Set(dto.ids)];
    const products = await this.prisma.product.findMany({ where: { id: { in: ids }, deletedAt: null } });
    if (dto.categoryId) {
      const cat = await this.prisma.category.findUniqueOrThrow({ where: { id: dto.categoryId } });
      if (products.some((p) => p.gender !== cat.gender)) throw new BadRequestException('Category gender does not match some products');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const p of products) {
        await tx.product.update({
          where: { id: p.id },
          data: {
            status: dto.status,
            categoryId: dto.categoryId,
            basePrice: dto.pricePercent !== undefined ? Math.max(0, Math.round(p.basePrice * (1 + dto.pricePercent / 100))) : undefined,
          },
        });
      }
    });
    return { updated: products.length, missing: ids.filter((i) => !products.some((p) => p.id === i)) };
  }

  // ---------------------------------------------------------------- variants
  async addVariant(productId: string, dto: CreateVariantDto) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new NotFoundException('Product not found');
    const pc = await this.prisma.productColour.findUnique({ where: { productId_colourId: { productId, colourId: dto.colourId } } });
    if (!pc) throw new BadRequestException('Colour is not attached to this product; add it via PATCH colourIds first');
    const id = await this.prisma.$transaction((tx) => this.createVariant(tx, productId, product.slug, dto));
    return this.variantView(id);
  }

  async updateVariant(variantId: string, dto: UpdateVariantDto) {
    await this.prisma.variant.update({ where: { id: variantId }, data: dto });
    return this.variantView(variantId);
  }

  async removeVariant(variantId: string): Promise<void> {
    const used = await this.prisma.orderLine.count({ where: { variantId } });
    if (used > 0) throw new ConflictException('Variant is referenced by orders and cannot be deleted');
    const res = await this.prisma.variant.deleteMany({ where: { id: variantId } });
    if (res.count === 0) throw new NotFoundException('Variant not found');
  }

  private async variantView(id: string) {
    const v = await this.prisma.variant.findUniqueOrThrow({ where: { id }, include: { colour: true, inventory: true } });
    return {
      id: v.id,
      productId: v.productId,
      sku: v.sku,
      colourId: v.colourId,
      colourName: v.colour.name,
      size: v.size,
      priceOverride: v.priceOverride,
      barcode: v.barcode,
      onHand: v.inventory?.onHand ?? 0,
      reserved: v.inventory?.reserved ?? 0,
      available: (v.inventory?.onHand ?? 0) - (v.inventory?.reserved ?? 0),
    };
  }

  private async createVariant(
    tx: Db,
    productId: string,
    productSlug: string,
    v: { colourId: string; size: string; sku?: string; priceOverride?: number | null; barcode?: string; initialStock?: number },
  ): Promise<string> {
    const colour = await tx.colour.findUniqueOrThrow({ where: { id: v.colourId } });
    const dup = await tx.variant.findUnique({ where: { productId_colourId_size: { productId, colourId: v.colourId, size: v.size } } });
    if (dup) throw new ConflictException(`Variant ${colour.name} / ${v.size} already exists`);
    const base = v.sku ?? `${slugify(productSlug).toUpperCase().slice(0, 14)}-${slugify(colour.name).toUpperCase().slice(0, 4)}-${slugify(v.size).toUpperCase()}`;
    let sku = base;
    for (let i = 2; await tx.variant.findUnique({ where: { sku } }); i++) {
      if (v.sku) throw new ConflictException(`SKU ${v.sku} already exists`);
      sku = `${base}-${i}`;
    }
    const stock = v.initialStock ?? 0;
    const created = await tx.variant.create({
      data: {
        productId,
        colourId: v.colourId,
        size: v.size,
        sku,
        priceOverride: v.priceOverride ?? null,
        barcode: v.barcode,
        inventory: { create: { onHand: stock, reserved: 0 } },
      },
    });
    if (stock > 0) {
      await tx.inventoryMovement.create({ data: { variantId: created.id, delta: stock, reason: 'restock', note: 'Initial stock' } });
    }
    return created.id;
  }

  // ---------------------------------------------------------------- images
  async setImages(productId: string, dto: SetProductImagesDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { colours: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    const colourSet = new Set(product.colours.map((c) => c.colourId));
    for (const img of dto.images) {
      if (img.colourId && !colourSet.has(img.colourId)) throw new BadRequestException(`Colour ${img.colourId} is not attached to this product`);
    }
    const mediaIds = [...new Set(dto.images.map((i) => i.mediaId))];
    const found = await this.prisma.media.count({ where: { id: { in: mediaIds } } });
    if (found !== mediaIds.length) throw new BadRequestException('Unknown mediaId in images');

    const positions = new Map<string, number>();
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({ where: { productId } });
      await tx.productImage.createMany({
        data: dto.images.map((img) => {
          const group = img.colourId ?? 'shared';
          const position = positions.get(group) ?? 0;
          positions.set(group, position + 1);
          return { productId, mediaId: img.mediaId, colourId: img.colourId ?? null, alt: img.alt ?? '', position };
        }),
      });
    });
    return this.get(productId);
  }

  // ---------------------------------------------------------------- helpers
  private async assertSlugFree(tx: Db, slug: string): Promise<string> {
    if (await tx.product.findUnique({ where: { slug } })) throw new ConflictException(`Slug "${slug}" is already used`);
    return slug;
  }

  private async assertCategory(categoryId: string, gender?: string): Promise<void> {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c) throw new BadRequestException('Unknown categoryId');
    if (gender && c.gender !== gender) throw new BadRequestException(`Category belongs to ${c.gender}, product gender is ${gender}`);
  }

  private async assertColours(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const n = await this.prisma.colour.count({ where: { id: { in: ids } } });
    if (n !== new Set(ids).size) throw new BadRequestException('Unknown colourId in colourIds');
  }
}
