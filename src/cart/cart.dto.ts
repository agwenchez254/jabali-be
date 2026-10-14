import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class QuoteLineDto {
  @IsUUID() variantId: string;
  @IsInt() @Min(1) @Max(50) qty: number;
  /** Free-form gift options (wrap, ribbon, message...). Stored on the order line. */
  @IsOptional() @IsObject() gift?: Record<string, unknown>;
}

export class CartQuoteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => QuoteLineDto)
  lines: QuoteLineDto[];
  @IsOptional() @IsString() @MaxLength(40) promoCode?: string;
  @IsOptional() @IsIn(['delivery', 'pickup']) method?: 'delivery' | 'pickup';
  /** Required for delivery quotes that should include the fee. */
  @IsOptional() @IsString() @MaxLength(60) county?: string;
  /** Used for per-customer promo limits. */
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
}
