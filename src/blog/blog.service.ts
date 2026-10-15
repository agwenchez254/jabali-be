import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { BlogPost, Prisma } from '@prisma/client';
import { DomainError } from '../common/problem-details.filter';
import { pageArgs, toCursorPage, toPage } from '../common/pagination';
import { uniqueSlug } from '../common/utils';
import { PrismaService } from '../prisma/prisma.service';
import { docText, firstImage, safeUrl, sanitizeDoc } from './blog-doc';
import { CreatePostDto, PostListQuery, StorePostListQuery, UpdatePostDto } from './blog.dto';

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

/** `thumbnailUrl` is what lists show: the cover image, else the first image in the body. */
const card = (p: BlogPost) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  excerpt: p.excerpt,
  coverUrl: p.coverUrl,
  thumbnailUrl: p.coverUrl ?? firstImage(p.content),
  publishedAt: p.publishedAt,
});

@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  private clean(content: unknown) {
    try {
      return sanitizeDoc(content);
    } catch (e) {
      throw new BadRequestException(typeof e === 'string' ? e : 'The post body is not valid.');
    }
  }

  private cover(url: string | undefined): string | null | undefined {
    if (url === undefined) return undefined;
    if (url.trim() === '') return null;
    const safe = safeUrl(url);
    if (!safe) throw new BadRequestException('The cover image must be an http(s) or site-relative URL.');
    return safe;
  }

  // ------------------------------------------------------------------ admin
  async list(q: PostListQuery) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.BlogPostWhereInput = {
      status: q.status,
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.blogPost.count({ where }),
      this.prisma.blogPost.findMany({ where, skip, take, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] }),
    ]);
    return toPage(rows.map((p) => ({ ...card(p), status: p.status, updatedAt: p.updatedAt })), total, page, pageSize);
  }

  async get(id: string) {
    const p = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Post not found');
    return { ...card(p), status: p.status, content: p.content, createdAt: p.createdAt, updatedAt: p.updatedAt };
  }

  async create(dto: CreatePostDto) {
    const content = this.clean(dto.content ?? EMPTY_DOC);
    const slug = dto.slug ?? (await uniqueSlug(dto.title, async (s) => !!(await this.prisma.blogPost.findUnique({ where: { slug: s } }))));
    const excerpt = dto.excerpt?.trim() || docText(content).slice(0, 200);
    try {
      const p = await this.prisma.blogPost.create({
        data: { slug, title: dto.title.trim(), excerpt, coverUrl: this.cover(dto.coverUrl) ?? null, content: content as unknown as Prisma.InputJsonValue },
      });
      return this.get(p.id);
    } catch (e) {
      throw this.slugClash(e);
    }
  }

  async update(id: string, dto: UpdatePostDto) {
    await this.get(id);
    try {
      await this.prisma.blogPost.update({
        where: { id },
        data: {
          title: dto.title?.trim(),
          slug: dto.slug,
          excerpt: dto.excerpt?.trim(),
          coverUrl: this.cover(dto.coverUrl),
          content: dto.content === undefined ? undefined : (this.clean(dto.content) as unknown as Prisma.InputJsonValue),
        },
      });
    } catch (e) {
      throw this.slugClash(e);
    }
    return this.get(id);
  }

  async publish(id: string) {
    const p = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Post not found');
    if (!p.title.trim()) throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'title_required', 'Add a title before publishing.');
    await this.prisma.blogPost.update({ where: { id }, data: { status: 'published', publishedAt: p.publishedAt ?? new Date() } });
    return this.get(id);
  }

  async unpublish(id: string) {
    await this.get(id);
    await this.prisma.blogPost.update({ where: { id }, data: { status: 'draft' } });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const res = await this.prisma.blogPost.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Post not found');
  }

  private slugClash(e: unknown): unknown {
    return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'
      ? new DomainError(HttpStatus.CONFLICT, 'slug_taken', 'Another post already uses that address. Choose a different one.')
      : e;
  }

  // ------------------------------------------------------------------ storefront
  async storeList(q: StorePostListQuery) {
    const limit = q.limit ?? 12;
    const rows = await this.prisma.blogPost.findMany({
      where: { status: 'published' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = toCursorPage(rows, limit);
    return { items: page.items.map(card), nextCursor: page.nextCursor };
  }

  async storeGet(slug: string) {
    const p = await this.prisma.blogPost.findFirst({ where: { slug, status: 'published' } });
    if (!p) throw new NotFoundException('Post not found');
    return { ...card(p), content: p.content, updatedAt: p.updatedAt };
  }
}
