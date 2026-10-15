import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';
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

export class BatchDeleteMediaDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) ids: string[];
}

export class UploadMediaDto {
  @IsOptional() @IsString() @MaxLength(200) alt?: string;
}
