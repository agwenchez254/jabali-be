/**
 * Pure pricing / discount engine. No I/O, no Date.now(): everything it needs is in the input,
 * so the same function prices a cart at quote time and at order creation.
 *
 * All money is integer KES.
 */

export type PromoType = 'percent' | 'fixed' | 'free_delivery' | 'bogo';
export type PromoStatus = 'draft' | 'active' | 'paused';
export type TargetType = 'all' | 'category' | 'product';

export interface PricingLine {
  /** Caller-chosen id (usually the variant id); echoed back in the breakdown. */
  lineId: string;
  productId: string;
  categoryId: string;
  unitPrice: number;
  qty: number;
}

export interface PricingPromotion {
  id: string;
  name: string;
  /** null = automatic promotion (applies without a code). */
  code: string | null;
  type: PromoType;
  /** percent: 1-100, fixed: KES, bogo: % off the "get" unit (0 means 100), free_delivery: ignored. */
  value: number;
  status: PromoStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  /** How many times the current customer already redeemed it (0 when unknown). */
  customerUses: number;
  /** Cart subtotal (before discounts) required. */
  minSubtotal: number;
  stackable: boolean;
  /** Higher priority is evaluated first. */
  priority: number;
  /** Empty or any `all` target means the whole cart. */
  targets: { type: TargetType; id: string | null }[];
}

export interface PricingDelivery {
  /** Base fee of the destination zone; 0 for pickup. */
  fee: number;
  /** Free delivery once (subtotal - discount) reaches this amount. */
  freeOver: number | null;
}

export interface PricingInput {
  lines: PricingLine[];
  /** Automatic promotions plus (optionally) the promotion matching `code`, whatever its state. */
  promotions: PricingPromotion[];
  code?: string | null;
  now: Date;
  delivery?: PricingDelivery | null;
}

export type CodeRejection =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'usage_limit_reached'
  | 'per_customer_limit_reached'
  | 'min_subtotal_not_met'
  | 'not_applicable'
  | 'not_stackable';

export interface LinePricing {
  lineId: string;
  unitPrice: number;
  qty: number;
  lineSubtotal: number;
  discount: number;
  lineTotal: number;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  code: string | null;
  type: PromoType;
  /** Item discount in KES (for free_delivery: the delivery fee waived). */
  amount: number;
  freeDelivery: boolean;
}

export interface PricingResult {
  lines: LinePricing[];
  subtotal: number;
  /** Item discount only. Waived delivery shows up as deliveryFee 0. */
  discount: number;
  deliveryFee: number;
  total: number;
  applied: AppliedPromotion[];
  /** Present when a code was supplied. */
  code: { code: string; valid: boolean; reason?: CodeRejection } | null;
}

const norm = (s: string) => s.trim().toUpperCase();

/** Splits `amount` across `weights` proportionally, using largest remainders so the parts sum exactly. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const floors = raw.map(Math.floor);
  let left = amount - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

function eligibleIndexes(p: PricingPromotion, lines: PricingLine[]): number[] {
  const t = p.targets;
  if (t.length === 0 || t.some((x) => x.type === 'all')) return lines.map((_, i) => i);
  const cats = new Set(t.filter((x) => x.type === 'category').map((x) => x.id));
  const prods = new Set(t.filter((x) => x.type === 'product').map((x) => x.id));
  return lines.flatMap((l, i) => (cats.has(l.categoryId) || prods.has(l.productId) ? [i] : []));
}

/** Static eligibility of a promotion (window, status, limits), independent of the cart. */
function rejectionFor(p: PricingPromotion, now: Date): CodeRejection | null {
  if (p.status !== 'active') return 'inactive';
  if (p.startsAt && p.startsAt > now) return 'not_started';
  if (p.endsAt && p.endsAt <= now) return 'expired';
  if (p.usageLimit !== null && p.usedCount >= p.usageLimit) return 'usage_limit_reached';
  if (p.perCustomerLimit !== null && p.customerUses >= p.perCustomerLimit) return 'per_customer_limit_reached';
  return null;
}

export function priceCart(input: PricingInput): PricingResult {
  const { now } = input;
  const lines = input.lines.map((l) => ({ ...l }));
  const lineSubtotals = lines.map((l) => l.unitPrice * l.qty);
  const subtotal = lineSubtotals.reduce((a, b) => a + b, 0);
  const discounts = lines.map(() => 0);
  const remaining = () => lineSubtotals.map((s, i) => s - discounts[i]);

  const wantedCode = input.code ? norm(input.code) : null;
  let codeResult: PricingResult['code'] = wantedCode ? { code: wantedCode, valid: false, reason: 'not_found' } : null;

  // 1. Candidates: automatic promotions + the one matching the code.
  const candidates: PricingPromotion[] = [];
  for (const p of input.promotions) {
    const isCoded = p.code !== null;
    if (!isCoded) {
      if (rejectionFor(p, now) === null) candidates.push(p);
    } else if (wantedCode && norm(p.code as string) === wantedCode) {
      const why = rejectionFor(p, now);
      if (why) codeResult = { code: wantedCode, valid: false, reason: why };
      else candidates.push(p);
    }
  }

  // 2. Evaluate by priority (desc); ties broken by id for determinism.
  candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  const applied: AppliedPromotion[] = [];
  const appliedPromos: PricingPromotion[] = [];
  let freeDelivery = false;
  const baseFee = input.delivery?.fee ?? 0;

  for (const p of candidates) {
    const isCodePromo = wantedCode !== null && p.code !== null && norm(p.code) === wantedCode;
    const reject = (reason: CodeRejection) => {
      if (isCodePromo) codeResult = { code: wantedCode as string, valid: false, reason };
    };

    if (subtotal < p.minSubtotal) {
      reject('min_subtotal_not_met');
      continue;
    }
    // stacking: a non-stackable promotion cannot join others and others cannot join it
    if (appliedPromos.length > 0 && (!p.stackable || appliedPromos.some((a) => !a.stackable))) {
      reject('not_stackable');
      continue;
    }

    let amount = 0;
    if (p.type === 'free_delivery') {
      if (!input.delivery || baseFee <= 0 || freeDelivery) {
        reject('not_applicable');
        continue;
      }
      freeDelivery = true;
      amount = baseFee;
    } else {
      const idx = eligibleIndexes(p, lines);
      const rem = remaining();
      const eligibleTotal = idx.reduce((a, i) => a + rem[i], 0);
      if (idx.length === 0 || eligibleTotal <= 0) {
        reject('not_applicable');
        continue;
      }
      const cut = new Array<number>(lines.length).fill(0);
      if (p.type === 'percent') {
        const pct = Math.min(100, Math.max(0, p.value));
        for (const i of idx) cut[i] = Math.min(rem[i], Math.round((rem[i] * pct) / 100));
      } else if (p.type === 'fixed') {
        const total = Math.min(Math.max(0, p.value), eligibleTotal);
        const parts = allocate(
          total,
          idx.map((i) => rem[i]),
        );
        idx.forEach((i, k) => (cut[i] = Math.min(rem[i], parts[k])));
      } else {
        // bogo-simple: pool the eligible units, every 2nd unit (cheapest first) gets `value`% off (0 => free)
        const pct = p.value > 0 ? Math.min(100, p.value) : 100;
        const units: { i: number; price: number }[] = [];
        for (const i of idx) {
          // price of one unit after earlier discounts on that line
          const perUnit = lines[i].qty > 0 ? rem[i] / lines[i].qty : 0;
          for (let n = 0; n < lines[i].qty; n++) units.push({ i, price: perUnit });
        }
        units.sort((a, b) => a.price - b.price);
        const free = Math.floor(units.length / 2);
        for (const u of units.slice(0, free)) cut[u.i] += (u.price * pct) / 100;
        for (const i of idx) cut[i] = Math.min(rem[i], Math.round(cut[i]));
      }
      amount = cut.reduce((a, b) => a + b, 0);
      if (amount <= 0) {
        reject('not_applicable');
        continue;
      }
      cut.forEach((c, i) => (discounts[i] += c));
    }

    applied.push({
      promotionId: p.id,
      name: p.name,
      code: p.code,
      type: p.type,
      amount,
      freeDelivery: p.type === 'free_delivery',
    });
    appliedPromos.push(p);
    if (isCodePromo) codeResult = { code: wantedCode as string, valid: true };
  }

  const discount = discounts.reduce((a, b) => a + b, 0);
  let deliveryFee = baseFee;
  if (freeDelivery) {
    deliveryFee = 0;
  } else if (input.delivery?.freeOver != null && subtotal - discount >= input.delivery.freeOver) {
    deliveryFee = 0;
  }

  return {
    lines: lines.map((l, i) => ({
      lineId: l.lineId,
      unitPrice: l.unitPrice,
      qty: l.qty,
      lineSubtotal: lineSubtotals[i],
      discount: discounts[i],
      lineTotal: lineSubtotals[i] - discounts[i],
    })),
    subtotal,
    discount,
    deliveryFee,
    total: subtotal - discount + deliveryFee,
    applied,
    code: codeResult,
  };
}
