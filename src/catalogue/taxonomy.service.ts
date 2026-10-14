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
    const c = await this.prisma.category.create({
      data: { gender: dto.gender, slug, label: dto.label, tagline: dto.tagline ?? '', imageId: dto.imageId, sortOrder: dto.sortOrder ?? 0, parentId: dto.parentId },
    });
    return this.categoryView(c.id);
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    await this.prisma.category.update({ where: { id }, data: dto });
    return this.categoryView(id);
  }

  async deleteCategory(id: string): Promise<void> {
    const n = await this.prisma.product.count({ where: { categoryId: id } });
    if (n > 0) throw new ConflictException('Category still has products; move or delete them first');
    const res = await this.prisma.category.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Category not found');
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
