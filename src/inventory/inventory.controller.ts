import { Body, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../common/auth/auth.types';
import { AdminController, CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { AdjustInventoryDto, InventoryListQuery, MovementsQuery, UpdateThresholdDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

@AdminController('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get() @RequirePermissions('inventory:read')
  list(@Query() q: InventoryListQuery) {
    return this.inventory.list(q);
  }

  @Get('low-stock') @RequirePermissions('inventory:read')
  lowStock() {
    return this.inventory.lowStock();
  }

  @Post('adjust') @RequirePermissions('inventory:write')
  adjust(@Body() dto: AdjustInventoryDto, @CurrentUser() user: AuthUser) {
    return this.inventory.adjust(dto, user.id);
  }

  @Get(':variantId/movements') @RequirePermissions('inventory:read')
  movements(@Param('variantId', ParseUUIDPipe) variantId: string, @Query() q: MovementsQuery) {
    return this.inventory.movements(variantId, q);
  }

  @Patch(':variantId/threshold') @RequirePermissions('inventory:write')
  threshold(@Param('variantId', ParseUUIDPipe) variantId: string, @Body() dto: UpdateThresholdDto) {
    return this.inventory.updateThreshold(variantId, dto);
  }
}
