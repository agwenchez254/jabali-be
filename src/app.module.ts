import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CacheModule } from './common/cache/cache.service';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { SecurityLogModule } from './common/security-log/security-log.module';
import { CartModule } from './cart/cart.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { CheckoutModule } from './checkout/checkout.controller';
import { ConfigModule } from './config/config.module';
import { ContentModule } from './content/content.module';
import { DeliveryModule } from './delivery/delivery.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { MediaModule } from './media/media.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.service';
import { PromotionsModule } from './promotions/promotions.module';
import { StaffModule } from './staff/staff.module';
import { StoreEventsModule } from './store-events/store-events.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CacheModule,
    StoreEventsModule,
    RateLimitModule,
    SecurityLogModule,
    AuthModule,
    CustomerAuthModule,
    StaffModule,
    CatalogueModule,
    InventoryModule,
    PromotionsModule,
    DeliveryModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    CheckoutModule,
    ContentModule,
    MediaModule,
    AnalyticsModule,
    AuditModule,
    HealthModule,
  ],
})
export class AppModule {}
