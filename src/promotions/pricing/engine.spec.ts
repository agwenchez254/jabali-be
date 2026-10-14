import { allocate, PricingLine, PricingPromotion, priceCart } from './engine';

const NOW = new Date('2026-06-15T12:00:00Z');
const DAY = 86_400_000;

const line = (o: Partial<PricingLine> = {}): PricingLine => ({
  lineId: 'l1',
  productId: 'p1',
  categoryId: 'c1',
  unitPrice: 1000,
  qty: 1,
  ...o,
});

let seq = 0;
const promo = (o: Partial<PricingPromotion> = {}): PricingPromotion => ({
  id: `promo-${++seq}`,
  name: 'Promo',
  code: null,
  type: 'percent',
  value: 10,
  status: 'active',
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usedCount: 0,
  perCustomerLimit: null,
  customerUses: 0,
  minSubtotal: 0,
  stackable: false,
  priority: 0,
  targets: [],
  ...o,
});

describe('allocate', () => {
  it('splits exactly with largest remainders', () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect([...parts].sort()).toEqual([33, 33, 34]);
  });
  it('returns zeros for empty weights or amount', () => {
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(10, [0, 0])).toEqual([0, 0]);
  });
});

describe('priceCart: totals without promotions', () => {
  it('sums lines and adds delivery', () => {
    const r = priceCart({
      lines: [line({ unitPrice: 1500, qty: 2 }), line({ lineId: 'l2', unitPrice: 500 })],
      promotions: [],
      now: NOW,
      delivery: { fee: 250, freeOver: null },
    });
    expect(r.subtotal).toBe(3500);
    expect(r.discount).toBe(0);
    expect(r.deliveryFee).toBe(250);
    expect(r.total).toBe(3750);
    expect(r.code).toBeNull();
  });
  it('pickup has no delivery fee', () => {
    const r = priceCart({ lines: [line()], promotions: [], now: NOW, delivery: null });
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(1000);
  });
  it('free-over threshold waives the fee, measured after discounts', () => {
    const base = { lines: [line({ unitPrice: 5000 })], now: NOW, delivery: { fee: 300, freeOver: 5000 } };
    expect(priceCart({ ...base, promotions: [] }).deliveryFee).toBe(0);
    const withPromo = priceCart({ ...base, promotions: [promo({ value: 10 })] });
    expect(withPromo.subtotal - withPromo.discount).toBe(4500);
    expect(withPromo.deliveryFee).toBe(300);
  });
});

describe('percent', () => {
  it('applies to all lines and rounds per line', () => {
    const r = priceCart({
      lines: [line({ unitPrice: 999, qty: 1 }), line({ lineId: 'l2', unitPrice: 1001, qty: 1 })],
      promotions: [promo({ value: 10 })],
      now: NOW,
    });
    expect(r.lines[0].discount).toBe(100); // 99.9 -> 100
    expect(r.lines[1].discount).toBe(100); // 100.1 -> 100
    expect(r.discount).toBe(200);
    expect(r.total).toBe(1800);
    expect(r.applied).toHaveLength(1);
  });
  it('clamps values above 100', () => {
    const r = priceCart({ lines: [line()], promotions: [promo({ value: 250 })], now: NOW });
    expect(r.total).toBe(0);
  });
});

describe('fixed', () => {
  it('spreads the amount across eligible lines and never exceeds them', () => {
    const r = priceCart({
      lines: [line({ unitPrice: 1000 }), line({ lineId: 'l2', unitPrice: 3000 })],
      promotions: [promo({ type: 'fixed', value: 400 })],
      now: NOW,
    });
    expect(r.discount).toBe(400);
    expect(r.lines.map((l) => l.discount)).toEqual([100, 300]);
    const big = priceCart({ lines: [line({ unitPrice: 300 })], promotions: [promo({ type: 'fixed', value: 1000 })], now: NOW });
    expect(big.discount).toBe(300);
    expect(big.total).toBe(0);
  });
});

describe('bogo-simple', () => {
  it('makes the cheapest of every pair free', () => {
    const r = priceCart({
      lines: [line({ unitPrice: 2000, qty: 1 }), line({ lineId: 'l2', unitPrice: 500, qty: 1 })],
      promotions: [promo({ type: 'bogo', value: 0 })],
      now: NOW,
    });
    expect(r.discount).toBe(500);
    expect(r.lines[1].discount).toBe(500);
  });
  it('3 units -> 1 free; 4 units -> 2 free', () => {
    const three = priceCart({ lines: [line({ qty: 3 })], promotions: [promo({ type: 'bogo', value: 0 })], now: NOW });
    expect(three.discount).toBe(1000);
    const four = priceCart({ lines: [line({ qty: 4 })], promotions: [promo({ type: 'bogo', value: 0 })], now: NOW });
    expect(four.discount).toBe(2000);
  });
  it('value acts as % off the second unit', () => {
    const r = priceCart({ lines: [line({ qty: 2 })], promotions: [promo({ type: 'bogo', value: 50 })], now: NOW });
    expect(r.discount).toBe(500);
  });
  it('single unit gets nothing and is reported not_applicable for a code', () => {
    const r = priceCart({
      lines: [line()],
      promotions: [promo({ type: 'bogo', value: 0, code: 'BOGO' })],
      code: 'bogo',
      now: NOW,
    });
    expect(r.discount).toBe(0);
    expect(r.code).toEqual({ code: 'BOGO', valid: false, reason: 'not_applicable' });
  });
});

describe('free_delivery', () => {
  it('waives the fee and reports the saved amount', () => {
    const r = priceCart({
      lines: [line()],
      promotions: [promo({ type: 'free_delivery', value: 0 })],
      now: NOW,
      delivery: { fee: 450, freeOver: null },
    });
    expect(r.deliveryFee).toBe(0);
    expect(r.discount).toBe(0);
    expect(r.applied[0]).toMatchObject({ type: 'free_delivery', amount: 450, freeDelivery: true });
    expect(r.total).toBe(1000);
  });
  it('is not applicable for pickup', () => {
    const r = priceCart({
      lines: [line()],
      promotions: [promo({ type: 'free_delivery', code: 'SHIPFREE' })],
      code: 'SHIPFREE',
      now: NOW,
      delivery: null,
    });
    expect(r.code?.reason).toBe('not_applicable');
    expect(r.applied).toHaveLength(0);
  });
});

describe('targets', () => {
  const lines = [
    line({ lineId: 'a', productId: 'pA', categoryId: 'cShirts', unitPrice: 1000 }),
    line({ lineId: 'b', productId: 'pB', categoryId: 'cShoes', unitPrice: 2000 }),
  ];
  it('category target only discounts that category', () => {
    const r = priceCart({
      lines,
      promotions: [promo({ targets: [{ type: 'category', id: 'cShoes' }] })],
      now: NOW,
    });
    expect(r.lines.map((l) => l.discount)).toEqual([0, 200]);
  });
  it('product target only discounts that product', () => {
    const r = priceCart({ lines, promotions: [promo({ targets: [{ type: 'product', id: 'pA' }] })], now: NOW });
    expect(r.lines.map((l) => l.discount)).toEqual([100, 0]);
  });
  it('an all target discounts everything', () => {
    const r = priceCart({ lines, promotions: [promo({ targets: [{ type: 'all', id: null }] })], now: NOW });
    expect(r.discount).toBe(300);
  });
  it('no eligible lines => not applicable', () => {
    const r = priceCart({
      lines,
      promotions: [promo({ code: 'X', targets: [{ type: 'product', id: 'nope' }] })],
      code: 'X',
      now: NOW,
    });
    expect(r.code).toEqual({ code: 'X', valid: false, reason: 'not_applicable' });
  });
});

describe('coded promotions and validity windows', () => {
  const coded = (o: Partial<PricingPromotion> = {}) => promo({ code: 'WELCOME10', ...o });
  const run = (p: PricingPromotion, code: string | null = 'welcome10') =>
    priceCart({ lines: [line({ unitPrice: 2000 })], promotions: [p], code, now: NOW });

  it('applies a valid code case-insensitively', () => {
    const r = run(coded());
    expect(r.code).toEqual({ code: 'WELCOME10', valid: true });
    expect(r.discount).toBe(200);
  });
  it('ignores coded promotions when no code is supplied', () => {
    expect(run(coded(), null).discount).toBe(0);
  });
  it('unknown code', () => {
    expect(run(coded(), 'NOPE').code).toEqual({ code: 'NOPE', valid: false, reason: 'not_found' });
  });
  it('paused/draft => inactive', () => {
    expect(run(coded({ status: 'paused' })).code?.reason).toBe('inactive');
    expect(run(coded({ status: 'draft' })).code?.reason).toBe('inactive');
  });
  it('before start => not_started', () => {
    expect(run(coded({ startsAt: new Date(NOW.getTime() + DAY) })).code?.reason).toBe('not_started');
  });
  it('after end => expired; end is exclusive', () => {
    expect(run(coded({ endsAt: new Date(NOW.getTime() - DAY) })).code?.reason).toBe('expired');
    expect(run(coded({ endsAt: NOW })).code?.reason).toBe('expired');
    expect(run(coded({ endsAt: new Date(NOW.getTime() + 1) })).code?.valid).toBe(true);
  });
  it('start is inclusive', () => {
    expect(run(coded({ startsAt: NOW })).code?.valid).toBe(true);
  });
  it('usage limit', () => {
    expect(run(coded({ usageLimit: 5, usedCount: 5 })).code?.reason).toBe('usage_limit_reached');
    expect(run(coded({ usageLimit: 5, usedCount: 4 })).code?.valid).toBe(true);
  });
  it('per-customer limit', () => {
    expect(run(coded({ perCustomerLimit: 1, customerUses: 1 })).code?.reason).toBe('per_customer_limit_reached');
    expect(run(coded({ perCustomerLimit: 2, customerUses: 1 })).code?.valid).toBe(true);
  });
  it('minimum subtotal is checked against the cart subtotal', () => {
    expect(run(coded({ minSubtotal: 2500 })).code?.reason).toBe('min_subtotal_not_met');
    expect(run(coded({ minSubtotal: 2000 })).code?.valid).toBe(true);
  });
  it('automatic promotions outside their window are skipped silently', () => {
    const r = priceCart({
      lines: [line()],
      promotions: [promo({ endsAt: new Date(NOW.getTime() - 1) })],
      now: NOW,
    });
    expect(r.applied).toHaveLength(0);
  });
});

describe('priority and stacking', () => {
  const lines = [line({ unitPrice: 10_000 })];

  it('non-stackable promotions: only the highest priority wins', () => {
    const r = priceCart({
      lines,
      promotions: [
        promo({ id: 'low', value: 5, priority: 1 }),
        promo({ id: 'high', value: 20, priority: 10 }),
      ],
      now: NOW,
    });
    expect(r.applied.map((a) => a.promotionId)).toEqual(['high']);
    expect(r.discount).toBe(2000);
  });
  it('stackable promotions compound on the remaining amount, in priority order', () => {
    const r = priceCart({
      lines,
      promotions: [
        promo({ id: 'a', value: 10, priority: 5, stackable: true }),
        promo({ id: 'b', type: 'fixed', value: 500, priority: 1, stackable: true }),
      ],
      now: NOW,
    });
    expect(r.applied.map((a) => a.promotionId)).toEqual(['a', 'b']);
    expect(r.discount).toBe(1000 + 500);
    expect(r.total).toBe(8500);
  });
  it('a non-stackable promotion cannot join a stackable one that already applied', () => {
    const r = priceCart({
      lines,
      promotions: [
        promo({ id: 'a', value: 10, priority: 5, stackable: true }),
        promo({ id: 'b', code: 'B', value: 50, priority: 1, stackable: false }),
      ],
      code: 'B',
      now: NOW,
    });
    expect(r.applied.map((a) => a.promotionId)).toEqual(['a']);
    expect(r.code?.reason).toBe('not_stackable');
  });
  it('stacked percent discounts can never push a line below zero', () => {
    const r = priceCart({
      lines: [line({ unitPrice: 100 })],
      promotions: [
        promo({ id: 'a', value: 100, priority: 2, stackable: true }),
        promo({ id: 'b', type: 'fixed', value: 500, priority: 1, stackable: true }),
      ],
      now: NOW,
    });
    expect(r.total).toBe(0);
    expect(r.lines[0].lineTotal).toBe(0);
  });
  it('is deterministic for equal priorities', () => {
    const ps = [promo({ id: 'z', value: 10 }), promo({ id: 'a', value: 30 })];
    const r1 = priceCart({ lines, promotions: ps, now: NOW });
    const r2 = priceCart({ lines, promotions: [...ps].reverse(), now: NOW });
    expect(r1.applied.map((a) => a.promotionId)).toEqual(r2.applied.map((a) => a.promotionId));
  });
  it('free delivery stacks with a percent code', () => {
    const r = priceCart({
      lines,
      promotions: [
        promo({ id: 'p', code: 'TEN', value: 10, stackable: true, priority: 2 }),
        promo({ id: 'f', type: 'free_delivery', stackable: true, priority: 1 }),
      ],
      code: 'ten',
      now: NOW,
      delivery: { fee: 350, freeOver: null },
    });
    expect(r.discount).toBe(1000);
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(9000);
  });
});

describe('invariants', () => {
  it('total = subtotal - discount + delivery and line discounts sum to discount', () => {
    const r = priceCart({
      lines: [line({ unitPrice: 1234, qty: 3 }), line({ lineId: 'l2', unitPrice: 777, qty: 2 })],
      promotions: [
        promo({ id: 'a', value: 15, priority: 3, stackable: true }),
        promo({ id: 'b', type: 'fixed', value: 999, priority: 2, stackable: true }),
        promo({ id: 'c', type: 'bogo', value: 0, priority: 1, stackable: true }),
      ],
      now: NOW,
      delivery: { fee: 250, freeOver: null },
    });
    expect(r.lines.reduce((a, l) => a + l.discount, 0)).toBe(r.discount);
    expect(r.total).toBe(r.subtotal - r.discount + r.deliveryFee);
    expect(r.lines.every((l) => l.lineTotal >= 0)).toBe(true);
    expect(Number.isInteger(r.total)).toBe(true);
  });
  it('does not mutate its input', () => {
    const lines = [line()];
    const snapshot = JSON.stringify(lines);
    priceCart({ lines, promotions: [promo()], now: NOW });
    expect(JSON.stringify(lines)).toBe(snapshot);
  });
});
