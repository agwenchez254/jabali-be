import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Trims before validation, so a name of only spaces fails the length check. */
const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEmail() @MaxLength(254) email: string;
  /** Kenyan mobile, e.g. 0712345678 or +254712345678 */
  @IsString() @MaxLength(20) phone: string;
  /** Length and strength are checked by the password policy for friendlier messages. */
  @IsString() @MaxLength(512) password: string;
}

export class CustomerLoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(512) password: string;
}

export class CustomerRefreshDto {
  @IsString() @MinLength(20) @MaxLength(200) refreshToken: string;
}

export class UpdateMeDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
}

export class VerifyEmailDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Matches(/^\d{6}$/, { message: 'code must be 6 digits' }) code: string;
  /** The password chosen at sign-up. Activation needs it as well as the code, so a pending sign-up cannot be hijacked. */
  @IsString() @MinLength(1) @MaxLength(512) password: string;
}

export class ResendCodeDto {
  @IsEmail() @MaxLength(254) email: string;
}
