import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { BlocksService } from './blocks.service';
import { CmsService } from './cms.service';
import {
  AdminBlocksController,
  AdminPagesController,
  AdminSettingsController,
  AdminTestimonialsController,
  ContentStoreController,
} from './content.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [CatalogueModule],
  controllers: [AdminBlocksController, AdminTestimonialsController, AdminPagesController, AdminSettingsController, ContentStoreController],
  providers: [BlocksService, CmsService, SettingsService],
  exports: [BlocksService, SettingsService],
})
export class ContentModule {}
