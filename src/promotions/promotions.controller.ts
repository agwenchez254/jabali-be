import { Body, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AdminController, RequirePermissions } from '../common/auth/decorators';
import { PageQueryDto } from '../common/pagination';
import { CreatePromotionDto, PromotionListQuery, UpdatePromotionDto } from './promotions.dto';
import { PromotionsService } from './promotions.service';

@AdminController('promotions', 'promotion')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get() @RequirePermissions('promotion:read')
  list(@Query() q: PromotionListQuery) {
    return this.promotions.list(q);
  }

  @Post() @RequirePermissions('promotion:write')
  create(@Body() dto: CreatePromotionDto) {
    return this.promotions.create(dto);
  }

  @Get(':id') @RequirePermissions('promotion:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.promotions.get(id);
  }

  @Patch(':id') @RequirePermissions('promotion:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotions.update(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('promotion:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.promotions.remove(id);
  }

  @Post(':id/activate') @HttpCode(200) @RequirePermissions('promotion:write')
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.promotions.setStatus(id, 'active');
  }

  @Post(':id/pause') @HttpCode(200) @RequirePermissions('promotion:write')
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.promotions.setStatus(id, 'paused');
  }

  @Get(':id/redemptions') @RequirePermissions('promotion:read')
  redemptions(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQueryDto) {
    return this.promotions.redemptions(id, q);
  }
}
