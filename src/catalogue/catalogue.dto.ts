import { PartialType } from '@nestjs/swagger';
import { Gender, ProductStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CursorQueryDto, PageQueryDto } from '../common/pagination';

// ------------------------------------------------------------- categories
export class CreateCategoryDto {
  @IsEnum(Gender) gender: Gender;
  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(80) slug?: string;
  @IsString() @MinLength(1) @MaxLength(120) label: string;
  @IsOptional() @IsString() @MaxLength(200) tagline?: string;
  @IsOptional() @IsUUID() imageId?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsUUID() parentId?: string;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

// ------------------------------------------------------------- colours
export class CreateColourDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  /** CSS hex colour, e.g. #1f2a44 */
  @Matches(/^#[0-9a-fA-F]{6}$/) hex: string;
}
export class UpdateColourDto extends PartialType(CreateColourDto) {}

// ------------------------------------------------------------- products
export class CreateProductDto {
  @IsString() @MinLength(2) @MaxLength(160) name: string;
  /** Generated from the name when omitted. */
  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(100) slug?: string;
  @IsEnum(Gender) gender: Gender;
  @IsUUID() categoryId: string;
  @IsOptional() @IsString() @MaxLength(2000) blurb?: string;
  /** Integer KES */
  @IsInt() @Min(0) @Max(100_000_000) basePrice: number;
  @IsOptional() @IsInt() @Min(0) compareAtPrice?: number | null;
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @IsOptional() @IsBoolean() isNew?: boolean;
  @IsOptional() @IsBoolean() isBestseller?: boolean;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(400) seoDescription?: string;

  /** Colours the product comes in (ordered). */
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsUUID('all', { each: true }) colourIds?: string[];
  /** With colourIds on create: generates a colour x size variant grid. */
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(20, { each: true }) sizes?: string[];
  /** Stock given to every generated variant. */
  @IsOptional() @IsInt() @Min(0) @Max(100_000) initialStock?: number;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(100) slug?: string;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(2000) blurb?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) basePrice?: number;
  @IsOptional() @IsInt() @Min(0) compareAtPrice?: number | null;
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @IsOptional() @IsBoolean() isNew?: boolean;
  @IsOptional() @IsBoolean() isBestseller?: boolean;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(400) seoDescription?: string;
  /** Replaces the product's colour list (order = sort order). Colours that still have variants cannot be removed. */
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsUUID('all', { each: true }) colourIds?: string[];
}

export class AdminProductListQuery extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  @IsOptional() @IsUUID() categoryId?: string;
  /** low = any variant at/below its threshold, out = no stock at all */
  @IsOptional() @IsIn(['low', 'out', 'in']) stock?: 'low' | 'out' | 'in';
}

export class CreateVariantDto {
  @IsUUID() colourId: string;
  @IsString() @MinLength(1) @MaxLength(20) size: string;
  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsInt() @Min(0) priceOverride?: number | null;
  @IsOptional() @IsString() @MaxLength(60) barcode?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) initialStock?: number;
}

export class UpdateVariantDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) sku?: string;
  @IsOptional() @IsInt() @Min(0) priceOverride?: number | null;
  @IsOptional() @IsString() @MaxLength(60) barcode?: string | null;
}

export class ImageAssignmentDto {
  @IsUUID() mediaId: string;
  /** null/omitted = shared gallery shown for every colour without its own images */
  @IsOptional() @IsUUID() colourId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) alt?: string;
}

export class SetProductImagesDto {
  /** Full ordered list. Position within each colour group follows array order. */
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ImageAssignmentDto)
  images: ImageAssignmentDto[];
}

export class BulkProductsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids: string[];
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  /** e.g. -10 lowers base prices by 10%, 5 raises them by 5%. Compare-at prices are untouched. */
  @IsOptional() @IsNumber() @Min(-90) @Max(500) pricePercent?: number;
  @IsOptional() @IsUUID() categoryId?: string;
}

// ------------------------------------------------------------- store queries
export class StoreProductsQuery extends CursorQueryDto {
  @IsOptional() @IsEnum(Gender) gender?: Gender;
  /** category slug */
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  /** colour name, e.g. Navy */
  @IsOptional() @IsString() @MaxLength(60) colour?: string;
  @IsOptional() @IsString() @MaxLength(20) size?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) min?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) max?: number;
  @IsOptional() @IsIn(['newest', 'price_asc', 'price_desc', 'popular', 'rating']) sort?: 'newest' | 'price_asc' | 'price_desc' | 'popular' | 'rating';
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class StoreCategoriesQuery {
  @IsOptional() @IsEnum(Gender) gender?: Gender;
}
