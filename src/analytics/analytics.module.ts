import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({ imports: [InventoryModule], controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
