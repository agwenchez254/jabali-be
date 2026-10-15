import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AdminController, RequirePermissions } from '../common/auth/decorators';
import { CustomerListQuery } from './customers.dto';
import { CustomersService } from './customers.service';

@AdminController('customers', 'customer')
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get() @RequirePermissions('customer:read')
  list(@Query() q: CustomerListQuery) {
    return this.customers.list(q);
  }

  @Get(':id') @RequirePermissions('customer:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  /** 409 `active_orders` (with the orders listed) while any order is pending, paid, packed or shipped. */
  @Post(':id/deactivate') @HttpCode(200) @RequirePermissions('customer:write')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.deactivate(id);
  }

  @Post(':id/activate') @HttpCode(200) @RequirePermissions('customer:write')
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.activate(id);
  }
}
