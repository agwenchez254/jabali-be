import { Body, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { AuthUser } from '../common/auth/auth.types';
import { AdminController, CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { MediaListQuery, RegisterExternalMediaDto, UpdateMediaDto, UploadMediaDto } from './media.dto';
import { MediaService } from './media.service';

@AdminController('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get() @RequirePermissions('media:read')
  list(@Query() q: MediaListQuery) {
    return this.media.list(q);
  }

  /** multipart/form-data: `file` (JPEG/PNG/WebP/GIF/AVIF, size limit from MAX_UPLOAD_MB) and optional `alt`. */
  @Post() @RequirePermissions('media:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, alt: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: UploadMediaDto, @CurrentUser() user: AuthUser) {
    return this.media.upload(file, body.alt, user.id);
  }

  /** Registers an https image URL (CDN, Unsplash) without uploading. */
  @Post('external') @RequirePermissions('media:write')
  external(@Body() dto: RegisterExternalMediaDto, @CurrentUser() user: AuthUser) {
    return this.media.registerExternal(dto, user.id);
  }

  @Patch(':id') @RequirePermissions('media:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMediaDto) {
    return this.media.update(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('media:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.media.remove(id);
  }
}
