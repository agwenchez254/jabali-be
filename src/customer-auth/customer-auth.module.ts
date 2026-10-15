import { Module } from '@nestjs/common';
import { CustomerAuthGuard } from '../common/auth/customer.guard';
import { CustomerAuthController, StoreMeController } from './customer-auth.controller';
import { AddressesService } from './addresses.service';
import { CustomerAuthService } from './customer-auth.service';

@Module({
  controllers: [CustomerAuthController, StoreMeController],
  providers: [CustomerAuthService, AddressesService, CustomerAuthGuard],
  exports: [CustomerAuthService],
})
export class CustomerAuthModule {}
