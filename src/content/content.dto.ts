import { PartialType } from '@nestjs/swagger';
import { ContentKind, Gender, PublishStatus } from '@prisma/client';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBlockDto {
  /** Unique key, e.g. "home.hero.men" */
  @IsString() @Matches(/^[a-z0-9][a-z0-9._-]*$/) @MaxLength(80) key: string;
  @IsEnum(ContentKind) kind: ContentKind;
  /** null/omitted = shown for every gender */
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  /** Block payload (shape depends on `kind`). Saved as the draft; call publish to make it live. */
  @IsObject() data: Record<string, unknown>;
  @IsOptional() @IsDateString() publishAt?: string;
  @IsOptional() @IsDateString() unpublishAt?: string;
}

export class UpdateBlockDto {
  /** Replaces the draft content. */
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  @IsOptional() @IsEnum(Gender) gender?: Gender | null;
  @IsOptional() @IsDateString() publishAt?: string | null;
  @IsOptional() @IsDateString() unpublishAt?: string | null;
}

export class BlockListQuery {
  @IsOptional() @IsEnum(ContentKind) kind?: ContentKind;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsEnum(PublishStatus) status?: PublishStatus;
}

export class ScheduleBlockDto {
  /** The draft goes live automatically at this time. */
  @IsDateString() publishAt: string;
  @IsOptional() @IsDateString() unpublishAt?: string;
}

export class PublishBlockDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class RollbackBlockDto {
  @IsInt() @Min(1) version: number;
}

export class CreateTestimonialDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(120) location?: string;
  @IsString() @MinLength(5) @MaxLength(600) quote: string;
  @IsOptional() @IsUUID() avatarMediaId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  /** null/omitted = shown for both genders */
  @IsOptional() @IsEnum(Gender) gender?: Gender | null;
  @IsOptional() @IsBoolean() isLead?: boolean;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
export class UpdateTestimonialDto extends PartialType(CreateTestimonialDto) {}

export class ReorderDto {
  /** Ids in the new display order */
  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids: string[];
}

export class CreatePageDto {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(80) slug: string;
  @IsString() @MinLength(1) @MaxLength(160) title: string;
  /** Ordered content blocks, e.g. [{ "type": "heading", "text": "..." }, { "type": "paragraph", "text": "..." }] */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsObject({ each: true }) blocks?: Record<string, unknown>[];
  @IsOptional() @IsEnum(PublishStatus) status?: PublishStatus;
}
export class UpdatePageDto extends PartialType(CreatePageDto) {}

export class SetSettingDto {
  /** JSON value; validated per key (see GET /admin/settings/schema) */
  @Allow() value: unknown;
}
