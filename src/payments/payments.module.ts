import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AdminPaymentsController, MpesaWebhookController, StorePaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CodProvider } from './providers/cod.provider';
import { MockProvider } from './providers/mock.provider';
import { MpesaDarajaProvider } from './providers/mpesa-daraja.provider';

@Module({
  imports: [OrdersModule],
  controllers: [StorePaymentsController, MpesaWebhookController, AdminPaymentsController],
  providers: [PaymentsService, CodProvider, MockProvider, MpesaDarajaProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
