import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminController, RequirePermissions } from '../common/auth/decorators';
import { CreateZoneDto, QuoteQuery, UpdateZoneDto } from './delivery.dto';
import { DeliveryService } from './delivery.service';

@AdminController('delivery/zones', 'delivery_zone')
export class AdminDeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get() @RequirePermissions('delivery:read')
  list() {
    return this.delivery.listZones();
  }

  @Post() @RequirePermissions('delivery:write')
  create(@Body() dto: CreateZoneDto) {
    return this.delivery.createZone(dto);
  }

  @Patch(':id') @RequirePermissions('delivery:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateZoneDto) {
    return this.delivery.updateZone(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('delivery:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.delivery.deleteZone(id);
  }
}

@ApiTags('store')
@Controller('store/delivery')
export class StoreDeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('zones')
  zones() {
    return this.delivery.storeZones();
  }

  /** GET /store/delivery/quote?county=Nairobi&subtotal=4000 */
  @Get('quote')
  quote(@Query() q: QuoteQuery) {
    return this.delivery.quote(q.county, q.subtotal ?? 0);
  }
}
