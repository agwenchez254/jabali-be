import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminController, RequirePermissions } from '../common/auth/decorators';
import { NoAudit } from '../common/audit.interceptor';
import { PreviewPromotionDto } from '../promotions/promotions.dto';
import { PromotionsService } from '../promotions/promotions.service';
import { CartQuoteDto } from './cart.dto';
import { CartService } from './cart.service';

@ApiTags('store')
@Controller('store/cart')
export class StoreCartController {
  constructor(private readonly cart: CartService) {}

  /** Authoritative totals for a cart: line prices, discount breakdown, delivery fee and stock warnings. */
  @Post('quote')
  @HttpCode(200)
  quote(@Body() dto: CartQuoteDto) {
    return this.cart.quote(dto);
  }
}

@AdminController('promotions/preview', 'promotion')
export class PromotionPreviewController {
  constructor(
    private readonly cart: CartService,
    private readonly promotions: PromotionsService,
  ) {}

  /** Live preview: how a (not yet saved) promotion would price a sample cart. */
  @Post() @HttpCode(200) @NoAudit() @RequirePermissions('promotion:read')
  async preview(@Body() dto: PreviewPromotionDto) {
    PromotionsService.validate(dto.promotion);
    const p = dto.promotion;
    const hypothetical = this.promotions.toPricing(
      {
        id: 'preview',
        name: p.name,
        code: p.code?.toUpperCase() ?? null,
        type: p.type,
        value: p.value,
        status: 'active',
        startsAt: null,
        endsAt: null,
        usageLimit: null,
        usedCount: 0,
        perCustomerLimit: null,
        minSubtotal: p.minSubtotal ?? 0,
        stackable: p.stackable ?? false,
        priority: p.priority ?? 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        targets: (p.targets ?? [{ targetType: 'all' as const }]).map((t, i) => ({
          id: String(i),
          promotionId: 'preview',
          targetType: t.targetType,
          targetId: 'targetId' in t && t.targetId ? t.targetId : null,
        })),
      },
      0,
    );
    return this.cart.quote(
      { lines: dto.lines, promoCode: p.code, county: dto.county, method: dto.county ? 'delivery' : 'pickup' },
      { promotions: [hypothetical] },
    );
  }
}
