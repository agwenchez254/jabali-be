import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { PromotionPreviewController, StoreCartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [DeliveryModule, PromotionsModule],
  controllers: [StoreCartController, PromotionPreviewController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
