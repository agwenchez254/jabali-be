import { DeliveryZone } from '@prisma/client';
import { PricingResult } from '../../promotions/pricing/engine';

export interface ResolvedItem {
  variantId: string;
  productId: string;
  categoryId: string;
  productName: string;
  colour: string;
  size: string;
  sku: string;
  unitPrice: number;
  qty: number;
  available: number;
  image: string | null;
  gift: Record<string, unknown> | null;
}

export interface CartWarning {
  variantId: string;
  type: 'unavailable' | 'out_of_stock' | 'insufficient_stock';
  message: string;
  available: number;
}

export interface ResolvedCart {
  items: ResolvedItem[];
  warnings: CartWarning[];
}

export interface PricedCart {
  resolved: ResolvedCart;
  pricing: PricingResult;
  zone: DeliveryZone | null;
  method: 'delivery' | 'pickup';
}

export interface CartQuote {
  lines: {
    variantId: string;
    productId: string;
    name: string;
    colour: string;
    size: string;
    sku: string;
    image: string | null;
    unitPrice: number;
    qty: number;
    lineSubtotal: number;
    discount: number;
    lineTotal: number;
    available: number;
  }[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  method: 'delivery' | 'pickup';
  /** True when delivery was requested but no county was given, so the fee is not included yet. */
  deliveryPending: boolean;
  delivery: { zone: string; eta: string; etaDays: number } | null;
  applied: PricingResult['applied'];
  promo: PricingResult['code'];
  warnings: CartWarning[];
}
