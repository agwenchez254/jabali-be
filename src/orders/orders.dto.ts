import { FulfilmentMethod, OrderStatus, PaymentProvider } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { QuoteLineDto } from '../cart/cart.dto';
import { PageQueryDto } from '../common/pagination';

export class CheckoutCustomerDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  /** Kenyan mobile, e.g. 0712345678 or +254712345678 */
  @IsString() @MaxLength(20) phone: string;
  @IsOptional() @IsEmail() email?: string;
}

export class CheckoutDto {
  /** Ignored: the order always belongs to the authenticated customer. Kept optional for older clients. */
  @IsOptional() @ValidateNested() @Type(() => CheckoutCustomerDto) customer?: CheckoutCustomerDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => QuoteLineDto)
  lines: QuoteLineDto[];
  @IsOptional() @IsString() @MaxLength(40) promoCode?: string;
  @IsEnum(FulfilmentMethod) method: FulfilmentMethod;
  /** Required for delivery */
  @ValidateIf((o: CheckoutDto) => o.method === 'delivery') @IsString() @MinLength(1) @MaxLength(60) county?: string;
  /** Required for delivery */
  @ValidateIf((o: CheckoutDto) => o.method === 'delivery') @IsString() @MinLength(3) @MaxLength(300) address?: string;
  @IsIn(['cod', 'mpesa', 'airtel', 'card']) paymentMethod: PaymentProvider;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** Who receives the order, when that is not the account holder. */
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MaxLength(20) contactPhone?: string;
  /** Mobile-money number to prompt, when it is not the account's phone. */
  @IsOptional() @IsString() @MaxLength(20) payerPhone?: string;
}

export class AdminOrderListQuery extends PageQueryDto {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  /** order number, customer name, phone or email */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(FulfilmentMethod) method?: FulfilmentMethod;
  @IsOptional() @IsIn(['cod', 'mpesa', 'airtel', 'card']) paymentMethod?: PaymentProvider;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class TransitionDto {
  @IsEnum(OrderStatus) to: OrderStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RefundDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class TrackQuery {
  @IsString() @MinLength(5) @MaxLength(20) phone: string;
}
