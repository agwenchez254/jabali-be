import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

export class CustomerListQuery extends PageQueryDto {
  /** name, email or phone */
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['active', 'disabled', 'unverified', 'guest']) status?: 'active' | 'disabled' | 'unverified' | 'guest';
}
