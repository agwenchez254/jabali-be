import { Module } from '@nestjs/common';
import { CustomerAuthGuard } from '../common/auth/customer.guard';
import { CustomerAuthController, StoreMeController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';

@Module({
  controllers: [CustomerAuthController, StoreMeController],
  providers: [CustomerAuthService, CustomerAuthGuard],
  exports: [CustomerAuthService],
})
export class CustomerAuthModule {}
