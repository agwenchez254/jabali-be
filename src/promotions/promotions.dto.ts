import { PartialType } from '@nestjs/swagger';
import { PromotionTargetType, PromotionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';
import { QuoteLineDto } from '../cart/cart.dto';

export class PromotionTargetDto {
  @IsEnum(PromotionTargetType) targetType: PromotionTargetType;
  /** category or product id; omit for "all" */
  @ValidateIf((o: PromotionTargetDto) => o.targetType !== 'all') @IsUUID() targetId?: string;
}

export class CreatePromotionDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  /** Customer-entered code (case-insensitive, stored upper-case). Omit for an automatic promotion. */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{3,30}$/) code?: string;
  @IsEnum(PromotionType) type: PromotionType;
  /** percent: 1-100 · fixed: KES · bogo: % off the second unit (0 = free) · free_delivery: ignored */
  @IsInt() @Min(0) value: number;
  @IsOptional() @IsDateString() startsAt?: string | null;
  @IsOptional() @IsDateString() endsAt?: string | null;
  @IsOptional() @IsInt() @Min(1) usageLimit?: number | null;
  @IsOptional() @IsInt() @Min(1) perCustomerLimit?: number | null;
  /** Minimum cart subtotal (before discounts) in KES */
  @IsOptional() @IsInt() @Min(0) minSubtotal?: number;
  @IsOptional() @IsBoolean() stackable?: boolean;
  /** Higher runs first */
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PromotionTargetDto)
  targets?: PromotionTargetDto[];
}
export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {}

export class PromotionListQuery extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(['draft', 'active', 'paused']) status?: 'draft' | 'active' | 'paused';
}

export class PreviewPromotionDto {
  @ValidateNested() @Type(() => CreatePromotionDto) promotion: CreatePromotionDto;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines: QuoteLineDto[];
  @IsOptional() @IsString() county?: string;
}
