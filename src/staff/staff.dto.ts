import { IsArray, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PERMISSIONS } from '../common/permissions';

export class CreateStaffDto {
  @IsString() @MinLength(2) @MaxLength(120)
  name: string;

  @IsEmail()
  email: string;

  @IsString() @MinLength(10) @MaxLength(200)
  password: string;

  @IsUUID()
  roleId: string;
}

export class UpdateStaffDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @IsOptional() @IsUUID()
  roleId?: string;

  @IsOptional() @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  /** Reset the password (revokes the user's refresh tokens). */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200)
  password?: string;
}

export class CreateRoleDto {
  @IsString() @MinLength(2) @MaxLength(60)
  name: string;

  @IsOptional() @IsString() @MaxLength(200)
  description?: string;

  @IsArray() @IsIn([...PERMISSIONS], { each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60)
  name?: string;

  @IsOptional() @IsString() @MaxLength(200)
  description?: string;

  @IsOptional() @IsArray() @IsIn([...PERMISSIONS], { each: true })
  permissions?: string[];
}
