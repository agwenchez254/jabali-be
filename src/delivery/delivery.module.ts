import { Module } from '@nestjs/common';
import { AdminDeliveryController, StoreDeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({
  controllers: [AdminDeliveryController, StoreDeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
