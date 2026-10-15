import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CustomerAuthUser } from '../common/auth/auth.types';
import { CurrentCustomer } from '../common/auth/customer.decorators';
import { CustomerAuthGuard } from '../common/auth/customer.guard';
import { OrdersService } from './orders.service';

export class MyOrdersQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number = 10;
}

/** The signed-in customer's own orders. Another customer's order is "not found", never "forbidden". */
@ApiTags('store')
@ApiBearerAuth()
@UseGuards(CustomerAuthGuard)
@Controller('store/me/orders')
export class MyOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentCustomer() me: CustomerAuthUser, @Query() q: MyOrdersQuery) {
    return this.orders.listForCustomer(me.customerId, q.page ?? 1, q.limit ?? 10);
  }

  @Get(':number')
  get(@CurrentCustomer() me: CustomerAuthUser, @Param('number') number: string) {
    return this.orders.detailForCustomer(me, number);
  }
}
