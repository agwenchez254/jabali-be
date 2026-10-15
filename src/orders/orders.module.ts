import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { MyOrdersController } from './my-orders.controller';
import { AdminOrdersController, StoreOrderTrackingController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [CartModule],
  controllers: [AdminOrdersController, StoreOrderTrackingController, MyOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
