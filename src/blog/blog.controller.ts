import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminController, RequirePermissions } from '../common/auth/decorators';
import { BlogService } from './blog.service';
import { CreatePostDto, PostListQuery, StorePostListQuery, UpdatePostDto } from './blog.dto';

@AdminController('blog', 'blog_post')
export class AdminBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get() @RequirePermissions('blog:read')
  list(@Query() q: PostListQuery) {
    return this.blog.list(q);
  }

  @Get(':id') @RequirePermissions('blog:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.get(id);
  }

  @Post() @RequirePermissions('blog:write')
  create(@Body() dto: CreatePostDto) {
    return this.blog.create(dto);
  }

  @Patch(':id') @RequirePermissions('blog:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto) {
    return this.blog.update(id, dto);
  }

  @Post(':id/publish') @HttpCode(200) @RequirePermissions('blog:publish')
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.publish(id);
  }

  @Post(':id/unpublish') @HttpCode(200) @RequirePermissions('blog:publish')
  unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.blog.unpublish(id);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('blog:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.blog.remove(id);
  }
}

@ApiTags('store')
@Controller('store/blog')
export class StoreBlogController {
  constructor(private readonly blog: BlogService) {}

  /** GET /store/blog?limit=12&cursor=<id> : published posts, newest first. */
  @Get()
  list(@Query() q: StorePostListQuery) {
    return this.blog.storeList(q);
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.blog.storeGet(slug);
  }
}
