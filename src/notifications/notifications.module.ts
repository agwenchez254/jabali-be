import { Global, Module } from '@nestjs/common';
import { CustomerAuthGuard } from '../common/auth/customer.guard';
import { AdminNotificationsController, CustomerNotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  controllers: [AdminNotificationsController, CustomerNotificationsController],
  providers: [NotificationsService, CustomerAuthGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
