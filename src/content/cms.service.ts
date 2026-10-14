import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender, Prisma, Testimonial } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePageDto, CreateTestimonialDto, UpdatePageDto, UpdateTestimonialDto } from './content.dto';

type TestimonialRow = Testimonial & { avatar: { url: string } | null };

@Injectable()
export class CmsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- testimonials
  private tView(t: TestimonialRow) {
    return {
      id: t.id,
      name: t.name,
      location: t.location,
      quote: t.quote,
      rating: t.rating,
      gender: t.gender,
      isLead: t.isLead,
      isPublished: t.isPublished,
      sortOrder: t.sortOrder,
      avatarMediaId: t.avatarMediaId,
      avatar: t.avatar?.url ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  async listTestimonials() {
    const rows = await this.prisma.testimonial.findMany({ include: { avatar: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((r) => this.tView(r));
  }

  async createTestimonial(dto: CreateTestimonialDto) {
    const max = await this.prisma.testimonial.aggregate({ _max: { sortOrder: true } });
    const t = await this.prisma.testimonial.create({
      data: { ...dto, sortOrder: dto.sortOrder ?? (max._max.sortOrder ?? 0) + 1, location: dto.location ?? '' },
      include: { avatar: true },
    });
    return this.tView(t);
  }

  async updateTestimonial(id: string, dto: UpdateTestimonialDto) {
    const t = await this.prisma.testimonial.update({ where: { id }, data: dto, include: { avatar: true } });
    return this.tView(t);
  }

  async deleteTestimonial(id: string): Promise<void> {
    const res = await this.prisma.testimonial.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Testimonial not found');
  }

  async reorderTestimonials(ids: string[]) {
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.testimonial.update({ where: { id }, data: { sortOrder: i } })));
    return this.listTestimonials();
  }

  async publishedTestimonials(gender?: Gender) {
    const rows = await this.prisma.testimonial.findMany({
      where: { isPublished: true, OR: [{ gender: null }, ...(gender ? [{ gender }] : [])] },
      include: { avatar: true },
      orderBy: [{ isLead: 'desc' }, { sortOrder: 'asc' }],
    });
    return rows.map((t) => ({ id: t.id, name: t.name, location: t.location, quote: t.quote, rating: t.rating, isLead: t.isLead, avatar: t.avatar?.url ?? null }));
  }

  // ---------------------------------------------------------------- pages
  listPages() {
    return this.prisma.page.findMany({ orderBy: { slug: 'asc' } });
  }

  async getPage(id: string) {
    const p = await this.prisma.page.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Page not found');
    return p;
  }

  async createPage(dto: CreatePageDto) {
    if (await this.prisma.page.findUnique({ where: { slug: dto.slug } })) throw new ConflictException(`Page "${dto.slug}" already exists`);
    return this.prisma.page.create({
      data: { slug: dto.slug, title: dto.title, blocks: (dto.blocks ?? []) as Prisma.InputJsonValue, status: dto.status ?? 'draft' },
    });
  }

  async updatePage(id: string, dto: UpdatePageDto) {
    return this.prisma.page.update({
      where: { id },
      data: { slug: dto.slug, title: dto.title, status: dto.status, blocks: dto.blocks ? (dto.blocks as Prisma.InputJsonValue) : undefined },
    });
  }

  async deletePage(id: string): Promise<void> {
    const res = await this.prisma.page.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Page not found');
  }

  async publishedPage(slug: string) {
    const p = await this.prisma.page.findFirst({ where: { slug, status: 'published' } });
    if (!p) throw new NotFoundException('Page not found');
    return { slug: p.slug, title: p.title, blocks: p.blocks, updatedAt: p.updatedAt };
  }
}
