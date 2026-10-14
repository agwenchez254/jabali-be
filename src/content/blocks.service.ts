import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ContentBlock, Gender, Prisma } from '@prisma/client';
import { CacheService } from '../common/cache/cache.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { BlockListQuery, CreateBlockDto, ScheduleBlockDto, UpdateBlockDto } from './content.dto';

const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/** A block is publicly visible when published and not past its unpublish time. */
export function isLive(b: Pick<ContentBlock, 'status' | 'unpublishAt'>, now = new Date()): boolean {
  return b.status === 'published' && (!b.unpublishAt || b.unpublishAt > now);
}

@Injectable()
export class BlocksService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Content');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.enableScheduler) return;
    this.timer = setInterval(() => void this.publishDue().catch((e: unknown) => this.log.error(String(e))), 30_000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  view(b: ContentBlock, now = new Date()) {
    return {
      id: b.id,
      key: b.key,
      kind: b.kind,
      gender: b.gender,
      status: b.status,
      live: isLive(b, now),
      version: b.version,
      data: b.data,
      draftData: b.draftData,
      /** What an editor sees: the pending draft when there is one, otherwise the live content. */
      effective: b.draftData ?? b.data,
      hasUnpublishedChanges: b.draftData !== null,
      publishAt: b.publishAt,
      unpublishAt: b.unpublishAt,
      scheduled: b.publishAt !== null && b.publishAt > now,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }

  async list(q: BlockListQuery) {
    const rows = await this.prisma.contentBlock.findMany({
      where: { kind: q.kind, gender: q.gender, status: q.status },
      orderBy: [{ kind: 'asc' }, { key: 'asc' }],
    });
    return rows.map((b) => this.view(b));
  }

  private async find(id: string): Promise<ContentBlock> {
    const b = await this.prisma.contentBlock.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Content block not found');
    return b;
  }

  async get(id: string) {
    return this.view(await this.find(id));
  }

  /** Draft preview payload (what the block will look like once published). */
  async preview(id: string) {
    const b = await this.find(id);
    return { id: b.id, key: b.key, kind: b.kind, gender: b.gender, data: b.draftData ?? b.data, isDraft: b.draftData !== null };
  }

  async create(dto: CreateBlockDto) {
    if (await this.prisma.contentBlock.findUnique({ where: { key: dto.key } })) throw new ConflictException(`Block key "${dto.key}" already exists`);
    const b = await this.prisma.contentBlock.create({
      data: {
        key: dto.key,
        kind: dto.kind,
        gender: dto.gender,
        data: {},
        draftData: json(dto.data),
        publishAt: dto.publishAt ? new Date(dto.publishAt) : null,
        unpublishAt: dto.unpublishAt ? new Date(dto.unpublishAt) : null,
      },
    });
    return this.view(b);
  }

  async update(id: string, dto: UpdateBlockDto) {
    await this.find(id);
    const b = await this.prisma.contentBlock.update({
      where: { id },
      data: {
        draftData: dto.data ? json(dto.data) : undefined,
        gender: dto.gender,
        publishAt: dto.publishAt === undefined ? undefined : dto.publishAt ? new Date(dto.publishAt) : null,
        unpublishAt: dto.unpublishAt === undefined ? undefined : dto.unpublishAt ? new Date(dto.unpublishAt) : null,
      },
    });
    return this.view(b);
  }

  async remove(id: string): Promise<void> {
    const res = await this.prisma.contentBlock.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Content block not found');
  }

  /** Publishes the draft: the previous live data is archived as a version and `version` is bumped. */
  async publish(id: string, actorId: string | null) {
    const b = await this.prisma.$transaction((tx) => this.publishTx(tx, id, actorId));
    void this.cache.invalidate();
    return this.view(b);
  }

  private async publishTx(tx: Prisma.TransactionClient, id: string, actorId: string | null): Promise<ContentBlock> {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "content_blocks" WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundException('Content block not found');
    const b = await tx.contentBlock.findUniqueOrThrow({ where: { id } });
    if (b.draftData === null && b.status === 'published') throw new BadRequestException('Nothing to publish: no pending draft');
    if (b.draftData === null && b.version === 0) throw new BadRequestException('Block has no content to publish');
    if (b.version > 0) {
      await tx.contentBlockVersion.create({ data: { blockId: id, version: b.version, data: json(b.data), createdBy: actorId } });
    }
    return tx.contentBlock.update({
      where: { id },
      data: {
        data: json(b.draftData ?? b.data),
        draftData: Prisma.DbNull,
        status: 'published',
        version: b.version + 1,
        publishAt: null,
      },
    });
  }

  async unpublish(id: string) {
    await this.find(id);
    const b = await this.prisma.contentBlock.update({ where: { id }, data: { status: 'draft' } });
    void this.cache.invalidate();
    return this.view(b);
  }

  async schedule(id: string, dto: ScheduleBlockDto) {
    const b = await this.find(id);
    const at = new Date(dto.publishAt);
    if (b.draftData === null && b.version === 0) throw new BadRequestException('Block has no content to schedule');
    if (dto.unpublishAt && new Date(dto.unpublishAt) <= at) throw new BadRequestException('unpublishAt must be after publishAt');
    const updated = await this.prisma.contentBlock.update({
      where: { id },
      data: { publishAt: at, unpublishAt: dto.unpublishAt ? new Date(dto.unpublishAt) : undefined },
    });
    return this.view(updated);
  }

  async versions(id: string) {
    const b = await this.find(id);
    const rows = await this.prisma.contentBlockVersion.findMany({ where: { blockId: id }, orderBy: { version: 'desc' } });
    return {
      current: { version: b.version, data: b.data },
      versions: rows.map((r) => ({ version: r.version, data: r.data, createdBy: r.createdBy, createdAt: r.createdAt })),
    };
  }

  /** Makes an older version live again (the current live data is archived as a new version first). */
  async rollback(id: string, version: number, actorId: string | null) {
    const b = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "content_blocks" WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Content block not found');
      const cur = await tx.contentBlock.findUniqueOrThrow({ where: { id } });
      const target = await tx.contentBlockVersion.findUnique({ where: { blockId_version: { blockId: id, version } } });
      if (!target) throw new NotFoundException(`Version ${version} not found`);
      await tx.contentBlockVersion.create({ data: { blockId: id, version: cur.version, data: json(cur.data), createdBy: actorId } });
      return tx.contentBlock.update({
        where: { id },
        data: { data: json(target.data), status: 'published', version: cur.version + 1 },
      });
    });
    void this.cache.invalidate();
    return this.view(b);
  }

  /** Publishes drafts whose scheduled time has arrived. Returns the number published. */
  async publishDue(now = new Date()): Promise<number> {
    const due = await this.prisma.contentBlock.findMany({ where: { publishAt: { lte: now } }, select: { id: true } });
    let n = 0;
    for (const { id } of due) {
      try {
        await this.prisma.$transaction((tx) => this.publishTx(tx, id, null));
        n++;
      } catch {
        // nothing to publish (already live): clear the stale schedule
        await this.prisma.contentBlock.update({ where: { id }, data: { publishAt: null } });
      }
    }
    if (n) void this.cache.invalidate();
    return n;
  }

  // ------------------------------------------------------------------ storefront
  async liveFor(gender?: Gender) {
    const now = new Date();
    const rows = await this.prisma.contentBlock.findMany({
      where: { status: 'published', OR: [{ gender: null }, ...(gender ? [{ gender }] : [])] },
      orderBy: [{ kind: 'asc' }, { key: 'asc' }],
    });
    return rows.filter((b) => isLive(b, now)).map((b) => ({ key: b.key, kind: b.kind, gender: b.gender, version: b.version, data: b.data }));
  }

  async liveByKey(key: string) {
    const b = await this.prisma.contentBlock.findUnique({ where: { key } });
    if (!b || !isLive(b)) throw new NotFoundException('Content not found');
    return { key: b.key, kind: b.kind, gender: b.gender, version: b.version, data: b.data };
  }
}
