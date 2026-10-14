import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StoreCategoriesQuery, StoreProductsQuery } from './catalogue.dto';
import { CatalogueStoreService } from './catalogue.store.service';

@ApiTags('store')
@Controller('store')
export class CatalogueStoreController {
  constructor(private readonly store: CatalogueStoreService) {}

  @Get('categories')
  categories(@Query() q: StoreCategoriesQuery) {
    return this.store.categories(q);
  }

  /** Cursor-paginated: pass the returned `nextCursor` back as `cursor`. */
  @Get('products')
  products(@Query() q: StoreProductsQuery) {
    return this.store.list(q);
  }

  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.store.bySlug(slug);
  }
}
