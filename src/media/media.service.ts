import { ConflictException, Inject, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Page, pageArgs, toPage } from '../common/pagination';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { sniffImage } from './image-info';
import { MediaListQuery, RegisterExternalMediaDto, UpdateMediaDto } from './media.dto';

const EXTERNAL_PREFIX = 'ext-';
/** Most images accepted by one POST /admin/media/batch request. */
export const MAX_BATCH_FILES = 20;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private view(m: Prisma.MediaGetPayload<{ include: { _count: { select: { productImages: true; categories: true; testimonials: true } } } }>) {
    return {
      id: m.id,
      url: m.url,
      mime: m.mime,
      width: m.width,
      height: m.height,
      bytes: m.bytes,
      alt: m.alt,
      external: m.key.startsWith(EXTERNAL_PREFIX),
      usage: { products: m._count.productImages, categories: m._count.categories, testimonials: m._count.testimonials },
      inUse: m._count.productImages + m._count.categories + m._count.testimonials > 0,
      createdAt: m.createdAt,
    };
  }

  private readonly include = { _count: { select: { productImages: true, categories: true, testimonials: true } } } as const;

  async upload(file: { buffer: Buffer; size: number } | undefined, alt: string | undefined, userId: string) {
    if (!file) throw new UnsupportedMediaTypeException('Send the image as multipart field "file"');
    const info = sniffImage(file.buffer);
    if (!info) throw new UnsupportedMediaTypeException('Only JPEG, PNG, WebP, GIF and AVIF images are accepted');
    const key = `${randomUUID()}.${info.ext}`;
    const dir = resolve(this.cfg.uploadDir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, key), file.buffer);
    const m = await this.prisma.media.create({
      data: {
        key,
        url: `${this.cfg.publicBaseUrl}/uploads/${key}`,
        mime: info.mime,
        width: info.width,
        height: info.height,
        bytes: file.size,
        alt: alt ?? '',
        uploadedBy: userId,
      },
      include: this.include,
    });
    return this.view(m);
  }

  /** Registers an already-hosted image (e.g. a CDN or Unsplash URL) in the media library. */
  async registerExternal(dto: RegisterExternalMediaDto, userId: string) {
    const key = `${EXTERNAL_PREFIX}${createHash('sha1').update(dto.url).digest('hex')}`;
    const m = await this.prisma.media.upsert({
      where: { key },
      update: { alt: dto.alt ?? undefined },
      create: { key, url: dto.url, mime: 'image/jpeg', alt: dto.alt ?? '', uploadedBy: userId },
      include: this.include,
    });
    return this.view(m);
  }

  async list(q: MediaListQuery): Promise<Page<ReturnType<MediaService['view']>>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.MediaWhereInput = q.q ? { OR: [{ alt: { contains: q.q, mode: 'insensitive' } }, { url: { contains: q.q, mode: 'insensitive' } }] } : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.media.count({ where }),
      this.prisma.media.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: this.include }),
    ]);
    return toPage(rows.map((r) => this.view(r)), total, page, pageSize);
  }

  async update(id: string, dto: UpdateMediaDto) {
    const m = await this.prisma.media.update({ where: { id }, data: { alt: dto.alt }, include: this.include });
    return this.view(m);
  }

  async remove(id: string): Promise<void> {
    const m = await this.prisma.media.findUnique({ where: { id }, include: this.include });
    if (!m) throw new NotFoundException('Media not found');
    const v = this.view(m);
    if (v.inUse) throw new ConflictException('Media is in use by products, categories or testimonials');
    await this.prisma.media.delete({ where: { id } });
    if (!v.external) await unlink(join(resolve(this.cfg.uploadDir), m.key)).catch(() => undefined);
  }
}
