import { BadRequestException, Body, Delete, Get, HttpCode, HttpException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { AuthUser } from '../common/auth/auth.types';
import { AdminController, CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { BatchDeleteMediaDto, MediaListQuery, RegisterExternalMediaDto, UpdateMediaDto, UploadMediaDto } from './media.dto';
import { MAX_BATCH_FILES, MediaService } from './media.service';

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
  async upload(@Req() req: FastifyRequest, @CurrentUser() user: AuthUser) {
    if (!req.isMultipart()) return this.media.upload(undefined, undefined, user.id);
    // Size and file-count limits are set where @fastify/multipart is registered (setup.ts); an oversize file throws 413.
    const part = await req.file({ limits: { files: 1, fields: 5 } });
    if (!part || part.fieldname !== 'file') return this.media.upload(undefined, undefined, user.id);
    const buffer = await part.toBuffer();
    // Fields that come after the file are only known once the file has been read.
    const alt = part.fields.alt;
    const dto = await this.altDto(alt && !Array.isArray(alt) && alt.type === 'field' ? String(alt.value) : undefined);
    return this.media.upload({ buffer, size: buffer.length }, dto.alt, user.id);
  }

  /**
   * Several images in one request. multipart/form-data with up to MAX_BATCH_FILES `files` parts (`file` is accepted too).
   * An `alt` field sent right after a file is that file's alt text. Each file succeeds or fails on its own:
   * the response lists the stored images in `items` and the rest, with the reason, in `failed`.
   */
  @Post('batch') @RequirePermissions('media:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } }, alt: { type: 'string', description: 'Alt text for the file sent just before it' } } } })
  async uploadBatch(@Req() req: FastifyRequest, @CurrentUser() user: AuthUser) {
    if (!req.isMultipart()) return this.media.upload(undefined, undefined, user.id);
    type Pending = { index: number; filename: string; buffer?: Buffer; error?: HttpException; alt?: string };
    const pending: Pending[] = [];
    let seen = 0;
    try {
      for await (const part of req.parts({ limits: { files: MAX_BATCH_FILES, fields: MAX_BATCH_FILES * 2 } })) {
        if (part.type === 'field') {
          const last = pending[pending.length - 1];
          if (part.fieldname === 'alt' && last && last.alt === undefined) last.alt = String(part.value);
          continue;
        }
        if (part.fieldname !== 'files' && part.fieldname !== 'file') {
          part.file.resume();
          continue;
        }
        const entry: Pending = { index: seen++, filename: part.filename };
        pending.push(entry);
        try {
          entry.buffer = await part.toBuffer();
        } catch (e) {
          entry.error = this.asHttp(e);
        }
      }
    } catch (e) {
      // Past the file limit the stream stops with an error; what was read before it is still stored.
      // An oversize file is raised again here when the stream ends, but it is already recorded against its own file.
      if ((e as { code?: string }).code !== 'FST_REQ_FILE_TOO_LARGE') pending.push({ index: seen, filename: '', error: this.asHttp(e) });
    }
    if (pending.length === 0) return this.media.upload(undefined, undefined, user.id);

    const items: Awaited<ReturnType<MediaService['upload']>>[] = [];
    const failed: { index: number; filename: string; status: number; message: string }[] = [];
    for (const p of pending) {
      try {
        if (p.error) throw p.error;
        const dto = await this.altDto(p.alt);
        items.push(await this.media.upload({ buffer: p.buffer!, size: p.buffer!.length }, dto.alt, user.id));
      } catch (e) {
        const err = this.asHttp(e);
        failed.push({ index: p.index, filename: p.filename, status: err.getStatus(), message: this.messageOf(err) });
      }
    }
    if (items.length === 0) throw new HttpException(failed[0].message, failed[0].status);
    return { items, failed };
  }

  /**
   * Deletes several images in one request. Each id succeeds or fails on its own: `deleted` lists the removed ids,
   * `failed` the rest with the reason (404 unknown, 409 still used by a product, category or testimonial).
   */
  @Post('batch/delete') @HttpCode(200) @RequirePermissions('media:write')
  async removeBatch(@Body() dto: BatchDeleteMediaDto) {
    const deleted: string[] = [];
    const failed: { id: string; status: number; message: string }[] = [];
    for (const id of dto.ids) {
      try {
        await this.media.remove(id);
        deleted.push(id);
      } catch (e) {
        const err = this.asHttp(e);
        failed.push({ id, status: err.getStatus(), message: this.messageOf(err) });
      }
    }
    return { deleted, failed };
  }

  private async altDto(alt: string | undefined): Promise<UploadMediaDto> {
    const dto = plainToInstance(UploadMediaDto, { alt });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) throw new BadRequestException({ message: 'Validation failed', code: 'validation_failed', errors: errors.flatMap((e) => Object.values(e.constraints ?? {}).map((message) => ({ field: e.property, message }))) });
    return dto;
  }

  /** Multipart errors carry a statusCode (413 for too large); anything else is not the client's fault. */
  private asHttp(e: unknown): HttpException {
    if (e instanceof HttpException) return e;
    const status = (e as { statusCode?: number }).statusCode;
    const message = e instanceof Error ? e.message : 'Upload failed';
    return new HttpException(message, typeof status === 'number' && status >= 400 && status < 500 ? status : 500);
  }

  private messageOf(e: HttpException): string {
    const r = e.getResponse();
    if (typeof r === 'string') return r;
    const m = (r as { message?: unknown }).message;
    return Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : e.message;
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
