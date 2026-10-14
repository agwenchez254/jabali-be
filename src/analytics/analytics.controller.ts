import { Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminController, RequirePermissions } from '../common/auth/decorators';
import { AnalyticsService } from './analytics.service';

class DaysQuery {
  /** Window length in days (default 30) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

class TopQuery extends DaysQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@AdminController('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Dashboard overview in one call: sales windows, orders by status, daily revenue, top products, low stock, recent orders. */
  @Get('summary') @RequirePermissions('analytics:read')
  summary(@Query() q: DaysQuery) {
    return this.analytics.summary(q.days ?? 30);
  }

  @Get('sales') @RequirePermissions('analytics:read')
  sales(@Query() q: DaysQuery) {
    return this.analytics.sales(q.days ?? 30);
  }

  @Get('top-products') @RequirePermissions('analytics:read')
  top(@Query() q: TopQuery) {
    return this.analytics.topProducts(q.limit ?? 5, q.days ?? 30);
  }
}
