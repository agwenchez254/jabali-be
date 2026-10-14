import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}

export class RefreshDto {
  /** Optional: when omitted the httpOnly `jabali_rt` cookie is used. */
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
