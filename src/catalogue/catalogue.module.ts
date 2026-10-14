import { Module } from '@nestjs/common';
import {
  AdminCategoriesController,
  AdminColoursController,
  AdminProductsController,
  AdminVariantsController,
} from './catalogue.admin.controller';
import { CatalogueStoreController } from './catalogue.store.controller';
import { CatalogueStoreService } from './catalogue.store.service';
import { ProductsService } from './products.service';
import { TaxonomyService } from './taxonomy.service';

@Module({
  controllers: [
    AdminProductsController,
    AdminVariantsController,
    AdminCategoriesController,
    AdminColoursController,
    CatalogueStoreController,
  ],
  providers: [ProductsService, TaxonomyService, CatalogueStoreService],
  exports: [CatalogueStoreService, TaxonomyService],
})
export class CatalogueModule {}
