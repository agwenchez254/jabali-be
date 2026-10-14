import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { AuthUser } from '../common/auth/auth.types';
import { AdminController, CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { CacheService } from '../common/cache/cache.service';
import { CatalogueStoreService } from '../catalogue/catalogue.store.service';
import { BlocksService } from './blocks.service';
import { CmsService } from './cms.service';
import {
  BlockListQuery,
  CreateBlockDto,
  CreatePageDto,
  CreateTestimonialDto,
  PublishBlockDto,
  ReorderDto,
  RollbackBlockDto,
  ScheduleBlockDto,
  SetSettingDto,
  UpdateBlockDto,
  UpdatePageDto,
  UpdateTestimonialDto,
} from './content.dto';
import { SettingsService } from './settings.service';

@AdminController('content/blocks', 'content_block')
export class AdminBlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get() @RequirePermissions('content:read')
  list(@Query() q: BlockListQuery) {
    return this.blocks.list(q);
  }

  @Post() @RequirePermissions('content:write')
  create(@Body() dto: CreateBlockDto) {
    return this.blocks.create(dto);
  }

  @Get(':id') @RequirePermissions('content:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.blocks.get(id);
  }

  /** Draft payload for the dashboard's side-by-side preview. */
  @Get(':id/preview') @RequirePermissions('content:read')
  preview(@Param('id', ParseUUIDPipe) id: string) {
    return this.blocks.preview(id);
  }

  /** Edits the DRAFT; the live content only changes on publish. */
  @Patch(':id') @RequirePermissions('content:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlockDto) {
    return this.blocks.update(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('content:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.blocks.remove(id);
  }

  @Post(':id/publish') @HttpCode(200) @RequirePermissions('content:publish')
  publish(@Param('id', ParseUUIDPipe) id: string, @Body() _dto: PublishBlockDto, @CurrentUser() user: AuthUser) {
    return this.blocks.publish(id, user.id);
  }

  @Post(':id/unpublish') @HttpCode(200) @RequirePermissions('content:publish')
  unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.blocks.unpublish(id);
  }

  @Post(':id/schedule') @HttpCode(200) @RequirePermissions('content:publish')
  schedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleBlockDto) {
    return this.blocks.schedule(id, dto);
  }

  @Get(':id/versions') @RequirePermissions('content:read')
  versions(@Param('id', ParseUUIDPipe) id: string) {
    return this.blocks.versions(id);
  }

  @Post(':id/rollback') @HttpCode(200) @RequirePermissions('content:publish')
  rollback(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RollbackBlockDto, @CurrentUser() user: AuthUser) {
    return this.blocks.rollback(id, dto.version, user.id);
  }
}

@AdminController('testimonials', 'testimonial')
export class AdminTestimonialsController {
  constructor(private readonly cms: CmsService) {}

  @Get() @RequirePermissions('content:read')
  list() {
    return this.cms.listTestimonials();
  }

  @Post() @RequirePermissions('content:write')
  create(@Body() dto: CreateTestimonialDto) {
    return this.cms.createTestimonial(dto);
  }

  /** Declared before :id so "reorder" is not parsed as an id. */
  @Put('reorder') @RequirePermissions('content:write')
  reorder(@Body() dto: ReorderDto) {
    return this.cms.reorderTestimonials(dto.ids);
  }

  @Patch(':id') @RequirePermissions('content:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTestimonialDto) {
    return this.cms.updateTestimonial(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('content:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cms.deleteTestimonial(id);
  }
}

@AdminController('pages', 'page')
export class AdminPagesController {
  constructor(private readonly cms: CmsService) {}

  @Get() @RequirePermissions('content:read')
  list() {
    return this.cms.listPages();
  }

  @Post() @RequirePermissions('content:write')
  create(@Body() dto: CreatePageDto) {
    return this.cms.createPage(dto);
  }

  @Get(':id') @RequirePermissions('content:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.cms.getPage(id);
  }

  @Patch(':id') @RequirePermissions('content:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePageDto) {
    return this.cms.updatePage(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('content:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cms.deletePage(id);
  }
}

@AdminController('settings', 'setting')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get() @RequirePermissions('settings:read')
  all() {
    return this.settings.all();
  }

  /** Lists the known setting keys and what they mean. */
  @Get('schema') @RequirePermissions('settings:read')
  schema() {
    return this.settings.describe();
  }

  @Put(':key') @RequirePermissions('settings:write')
  set(@Param('key') key: string, @Body() dto: SetSettingDto) {
    return this.settings.set(key, dto.value);
  }
}

class HomeQuery {
  @IsOptional() @IsEnum(Gender) gender?: Gender;
}

@ApiTags('store')
@Controller('store')
export class ContentStoreController {
  constructor(
    private readonly blocks: BlocksService,
    private readonly cms: CmsService,
    private readonly settings: SettingsService,
    private readonly catalogue: CatalogueStoreService,
    private readonly cache: CacheService,
  ) {}

  /** Everything the home page needs in one call: live blocks, testimonials, categories, top sellers, settings. */
  @Get('home')
  home(@Query() q: HomeQuery) {
    return this.cache.wrap(`store:home:${q.gender ?? 'all'}`, 60, async () => {
      const [blocks, testimonials, categories, top, settings] = await Promise.all([
        this.blocks.liveFor(q.gender),
        this.cms.publishedTestimonials(q.gender),
        this.catalogue.categories({ gender: q.gender }),
        this.catalogue.list({ gender: q.gender, sort: 'popular', limit: 5 }),
        this.settings.all(),
      ]);
      return { gender: q.gender ?? null, blocks, testimonials, categories, topProducts: top.items, settings };
    });
  }

  @Get('content/:key')
  content(@Param('key') key: string) {
    return this.blocks.liveByKey(key);
  }

  @Get('pages/:slug')
  page(@Param('slug') slug: string) {
    return this.cms.publishedPage(slug);
  }

  @Get('settings')
  siteSettings() {
    return this.cache.wrap('store:settings', 60, () => this.settings.all());
  }
}
