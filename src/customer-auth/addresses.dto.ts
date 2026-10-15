import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAddressDto {
  @IsString() @MinLength(1) @MaxLength(40) label: string;
  @IsString() @MinLength(2) @MaxLength(60) county: string;
  @IsString() @MinLength(2) @MaxLength(100) area: string;
  @IsString() @MinLength(3) @MaxLength(200) street: string;
  /** Who receives the order, when it is not the account holder. */
  @IsOptional() @IsString() @MaxLength(120) recipient?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) label?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) county?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) area?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) street?: string;
  @IsOptional() @IsString() @MaxLength(120) recipient?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
