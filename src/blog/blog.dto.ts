import { IsEnum, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PublishStatus } from '@prisma/client';
import { CursorQueryDto, PageQueryDto } from '../common/pagination';

export class CreatePostDto {
  @IsString() @MinLength(1) @MaxLength(160) title: string;
  /** Lower-case words joined by dashes. Made from the title when left out. */
  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(100) slug?: string;
  /** Short summary shown on the blog list. Taken from the body when left out. */
  @IsOptional() @IsString() @MaxLength(300) excerpt?: string;
  @IsOptional() @IsString() @MaxLength(2000) coverUrl?: string;
  /** Rich-text document (editor JSON). Cleaned server-side. */
  @IsOptional() @IsObject() content?: Record<string, unknown>;
}

export class UpdatePostDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) title?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(100) slug?: string;
  @IsOptional() @IsString() @MaxLength(300) excerpt?: string;
  /** Empty string removes the cover. */
  @IsOptional() @IsString() @MaxLength(2000) coverUrl?: string;
  @IsOptional() @IsObject() content?: Record<string, unknown>;
}

export class PostListQuery extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(PublishStatus) status?: PublishStatus;
}

export class StorePostListQuery extends CursorQueryDto {}
