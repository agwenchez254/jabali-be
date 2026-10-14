import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

export class MediaListQuery extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class UpdateMediaDto {
  @IsString() @MaxLength(200) alt: string;
}

export class RegisterExternalMediaDto {
  @IsUrl({ protocols: ['https'], require_protocol: true }) url: string;
  @IsOptional() @IsString() @MaxLength(200) alt?: string;
}

export class UploadMediaDto {
  @IsOptional() @IsString() @MaxLength(200) alt?: string;
}
