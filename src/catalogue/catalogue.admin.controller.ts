import { Body, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Gender } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { AdminController, RequirePermissions } from '../common/auth/decorators';
import {
  AdminProductListQuery,
  BulkProductsDto,
  CreateCategoryDto,
  CreateColourDto,
  CreateProductDto,
  CreateVariantDto,
  SetProductImagesDto,
  UpdateCategoryDto,
  UpdateColourDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './catalogue.dto';
import { ProductsService } from './products.service';
import { TaxonomyService } from './taxonomy.service';

class CategoryListQuery {
  @IsOptional() @IsEnum(Gender) gender?: Gender;
}

@AdminController('products', 'product')
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get() @RequirePermissions('product:read')
  list(@Query() q: AdminProductListQuery) {
    return this.products.list(q);
  }

  @Post() @RequirePermissions('product:write')
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  /** Declared before :id so "bulk" is not parsed as an id. */
  @Patch('bulk') @RequirePermissions('product:write')
  bulk(@Body() dto: BulkProductsDto) {
    return this.products.bulk(dto);
  }

  @Get(':id') @RequirePermissions('product:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.get(id);
  }

  @Patch(':id') @RequirePermissions('product:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('product:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.products.remove(id);
  }

  @Post(':id/variants') @RequirePermissions('product:write')
  addVariant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateVariantDto) {
    return this.products.addVariant(id, dto);
  }

  /** Replaces the whole gallery set (shared + per colour) in one call; array order = display order. */
  @Put(':id/images') @RequirePermissions('product:write')
  setImages(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetProductImagesDto) {
    return this.products.setImages(id, dto);
  }
}

@AdminController('variants', 'variant')
export class AdminVariantsController {
  constructor(private readonly products: ProductsService) {}

  @Patch(':id') @RequirePermissions('product:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVariantDto) {
    return this.products.updateVariant(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('product:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.products.removeVariant(id);
  }
}

@AdminController('categories', 'category')
export class AdminCategoriesController {
  constructor(private readonly tax: TaxonomyService) {}

  @Get() @RequirePermissions('product:read')
  list(@Query() q: CategoryListQuery) {
    return this.tax.listCategories(q.gender);
  }

  @Post() @RequirePermissions('product:write')
  create(@Body() dto: CreateCategoryDto) {
    return this.tax.createCategory(dto);
  }

  @Patch(':id') @RequirePermissions('product:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.tax.updateCategory(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('product:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tax.deleteCategory(id);
  }
}

@AdminController('colours', 'colour')
export class AdminColoursController {
  constructor(private readonly tax: TaxonomyService) {}

  @Get() @RequirePermissions('product:read')
  list() {
    return this.tax.listColours();
  }

  @Post() @RequirePermissions('product:write')
  create(@Body() dto: CreateColourDto) {
    return this.tax.createColour(dto);
  }

  @Patch(':id') @RequirePermissions('product:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateColourDto) {
    return this.tax.updateColour(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('product:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tax.deleteColour(id);
  }
}
