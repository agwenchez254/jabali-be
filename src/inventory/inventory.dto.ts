import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

export class InventoryListQuery extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() productId?: string;
  /** true => only variants at or below their low-stock threshold */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() low?: boolean;
}

export class AdjustInventoryDto {
  @IsUUID() variantId: string;
  /** Relative change, e.g. +20 restock or -2 damaged. */
  @IsOptional() @IsInt() @Min(-100_000) @Max(100_000) delta?: number;
  /** Absolute on-hand count (stocktake). Exactly one of delta / setTo. */
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) setTo?: number;
  @IsIn(['restock', 'adjustment', 'return', 'sale']) reason: 'restock' | 'adjustment' | 'return' | 'sale';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsString() @MaxLength(100) ref?: string;
}

export class UpdateThresholdDto {
  @IsInt() @Min(0) @Max(10_000) lowStockThreshold: number;
}

export class MovementsQuery extends PageQueryDto {}
