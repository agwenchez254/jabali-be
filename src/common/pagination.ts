import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CursorPage, Page } from './models';

// Re-exported so existing `from '../common/pagination'` imports keep working.
export type { CursorPage, Page };

/** Offset pagination used by admin lists: ?page=1&pageSize=20 */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

/** Cursor pagination used by storefront lists: ?limit=24&cursor=<opaque> */
export class CursorQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  limit?: number = 24;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export function pageArgs(q: PageQueryDto): { skip: number; take: number; page: number; pageSize: number } {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function toPage<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Prisma cursor pagination: fetch limit+1 rows, trim, and expose the last id as cursor. */
export function toCursorPage<T extends { id: string }>(rows: T[], limit: number): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
