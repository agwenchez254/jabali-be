import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender } from '@prisma/client';
import { slugify } from '../common/utils';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, CreateColourDto, UpdateCategoryDto, UpdateColourDto } from './catalogue.dto';

@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------- categories
  async listCategories(gender?: Gender) {
    const rows = await this.prisma.category.findMany({
      where: { gender },
      orderBy: [{ gender: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
      include: { image: true, _count: { select: { products: { where: { deletedAt: null } } } } },
    });
    return rows.map((c) => ({
      id: c.id,
      gender: c.gender,
      slug: c.slug,
      label: c.label,
      tagline: c.tagline,
      imageId: c.imageId,
      imageUrl: c.image?.url ?? null,
      sortOrder: c.sortOrder,
      parentId: c.parentId,
      productCount: c._count.products,
    }));
  }

  async createCategory(dto: CreateCategoryDto) {
    const slug = dto.slug ?? slugify(dto.label);
    if (!slug) throw new BadRequestException('Could not derive a slug from the label');
    if (await this.prisma.category.findUnique({ where: { gender_slug: { gender: dto.gender, slug } } })) {
      throw new ConflictException(`Category "${slug}" already exists for ${dto.gender}`);
    }
    await this.assertParent(undefined, dto.parentId, dto.gender);
    const c = await this.prisma.category.create({
      data: { gender: dto.gender, slug, label: dto.label, tagline: dto.tagline ?? '', imageId: dto.imageId, sortOrder: dto.sortOrder ?? 0, parentId: dto.parentId },
    });
    return this.categoryView(c.id);
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const current = await this.prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!current) throw new NotFoundException('Category not found');
    const gender = dto.gender ?? current.gender;
    const slug = dto.slug ?? current.slug;
    if (gender !== current.gender && current._count.products > 0) {
      throw new ConflictException({ message: 'Category has products, so it cannot move to another section. Move the products first.', code: 'category_in_use' });
    }
    if (gender !== current.gender || slug !== current.slug) {
      const clash = await this.prisma.category.findUnique({ where: { gender_slug: { gender, slug } } });
      if (clash && clash.id !== id) throw new ConflictException(`Category "${slug}" already exists for ${gender}`);
    }
    const parentId = dto.parentId === undefined ? current.parentId : dto.parentId;
    if (dto.parentId !== undefined || gender !== current.gender) await this.assertParent(id, parentId ?? undefined, gender);
    await this.prisma.category.update({ where: { id }, data: dto });
    return this.categoryView(id);
  }

  /** A category can only be deleted when nothing points at it: no products (archived and deleted ones included) and no subcategories. */
  async deleteCategory(id: string): Promise<void> {
    const c = await this.prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
    if (!c) throw new NotFoundException('Category not found');
    const live = await this.prisma.product.count({ where: { categoryId: id, deletedAt: null } });
    const n = c._count.products;
    if (n > 0) {
      const message =
        live > 0
          ? `Category is assigned to ${live} ${live === 1 ? 'product' : 'products'}. Move ${live === 1 ? 'it' : 'them'} to another category first.`
          : `Category is still referenced by ${n} deleted ${n === 1 ? 'product' : 'products'}, so it cannot be removed.`;
      throw new ConflictException({ message, code: 'category_in_use', productCount: live });
    }
    if (c._count.children > 0) {
      throw new ConflictException({ message: `Category has ${c._count.children} ${c._count.children === 1 ? 'subcategory' : 'subcategories'}. Move or delete ${c._count.children === 1 ? 'it' : 'them'} first.`, code: 'category_in_use' });
    }
    await this.prisma.category.delete({ where: { id } });
  }

  /** The parent must exist, sit in the same section, and not be the category itself or one of its descendants. */
  private async assertParent(id: string | undefined, parentId: string | undefined, gender: Gender): Promise<void> {
    if (!parentId) return;
    if (parentId === id) throw new BadRequestException('A category cannot be its own parent');
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException('Parent category not found');
    if (parent.gender !== gender) throw new BadRequestException('A parent must be in the same section (men or women)');
    for (let up = parent.parentId, hops = 0; id && up && hops < 50; hops++) {
      if (up === id) throw new BadRequestException('A category cannot sit under its own subcategory');
      up = (await this.prisma.category.findUnique({ where: { id: up }, select: { parentId: true } }))?.parentId ?? null;
    }
  }

  private async categoryView(id: string) {
    const all = await this.listCategories();
    const found = all.find((c) => c.id === id);
    if (!found) throw new NotFoundException('Category not found');
    return found;
  }

  // ---------------------------------------------------------- colours
  listColours() {
    return this.prisma.colour.findMany({ orderBy: { name: 'asc' } });
  }

  async createColour(dto: CreateColourDto) {
    if (await this.prisma.colour.findUnique({ where: { name: dto.name } })) throw new ConflictException('Colour name already exists');
    return this.prisma.colour.create({ data: { name: dto.name, hex: dto.hex.toLowerCase() } });
  }

  updateColour(id: string, dto: UpdateColourDto) {
    return this.prisma.colour.update({ where: { id }, data: { ...dto, hex: dto.hex?.toLowerCase() } });
  }

  async deleteColour(id: string): Promise<void> {
    const used = await this.prisma.productColour.count({ where: { colourId: id } });
    if (used > 0) throw new ConflictException('Colour is used by products');
    const res = await this.prisma.colour.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Colour not found');
  }
}
