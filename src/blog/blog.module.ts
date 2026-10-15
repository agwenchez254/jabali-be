import { Module } from '@nestjs/common';
import { AdminBlogController, StoreBlogController } from './blog.controller';
import { BlogService } from './blog.service';

@Module({ controllers: [AdminBlogController, StoreBlogController], providers: [BlogService] })
export class BlogModule {}
