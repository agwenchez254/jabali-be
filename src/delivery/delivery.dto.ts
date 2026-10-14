import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateZoneDto {
  /** Stable key, e.g. "nairobi" */
  @IsString() @Matches(/^[a-z0-9_-]+$/) @MaxLength(40) code: string;
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) counties: string[];
  /** Integer KES */
  @IsInt() @Min(0) fee: number;
  @IsOptional() @IsInt() @Min(0) etaDays?: number;
  /** Customer-facing delivery estimate text */
  @IsOptional() @IsString() @MaxLength(200) eta?: string;
  /** Delivery is free once the order (after discounts) reaches this KES amount. */
  @IsOptional() @IsInt() @Min(0) freeOver?: number | null;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateZoneDto extends PartialType(CreateZoneDto) {}

export class QuoteQuery {
  @IsString() @MinLength(1) county: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) subtotal?: number;
}
