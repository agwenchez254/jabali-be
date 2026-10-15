import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { bootApp, json } from './helpers/app';
import { newShopper, placePickupOrder, seedVariant, setSetting, staffAuth, VAT_OFF, VAT_ON } from './helpers/shop';

jest.setTimeout(90_000);

interface Summary {
  number: string;
  status: string;
  paymentStatus: string;
  method: string;
  paymentMethod: string;
  total: number;
  lineCount: number;
  createdAt: string;
}
interface Detail extends Summary {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  customer: { name: string; email: string; phone: string };
  vat: { ratePercent: number; amount: number; net: number; seller: { businessName: string; kraPin: string } } | null;
  lines: { name: string; colour: string; size: string; qty: number; unitPrice: number; lineTotal: number }[];
  payments: { provider: string; status: string; amount: number }[];
  timeline: { type: string; at: string }[];
}

describe('GET /store/me/orders', () => {
  let app: NestFastifyApplication;
  let base: string;
  let staff: Record<string, string>;

  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
    staff = await staffAuth(base);
    await setSetting(base, staff, 'vat', VAT_OFF);
  });
  afterAll(async () => {
    await app.close();
  });

  const list = (auth: Record<string, string>, qs = '') => fetch(`${base}/store/me/orders${qs}`, { headers: auth });
  const detail = (auth: Record<string, string>, number: string) => fetch(`${base}/store/me/orders/${number}`, { headers: auth });
  const place = async (who: Awaited<ReturnType<typeof newShopper>>, price: number, key: string, qty = 1) => {
    const { variantId, name } = await seedVariant(app, price);
    const r = await placePickupOrder(base, who, variantId, key, qty);
    expect(r.status).toBe(201);
    return { name, number: ((await r.json()) as { order: { number: string } }).order.number };
  };

  it('lists only the signed-in customer\'s own orders, newest first', async () => {
    const a = await newShopper(app, base, 'hista');
    const b = await newShopper(app, base, 'histb');
    const first = await place(a, 1000, 'hist-a-order-01');
    const second = await place(a, 2000, 'hist-a-order-02');
    const other = await place(b, 3000, 'hist-b-order-01');
    const res = await list(a.auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Summary[]; total: number; page: number; limit: number };
    expect(body.items.map((o) => o.number)).toEqual([second.number, first.number]);
    expect(body.total).toBe(2);
    expect(body.items[0]).toMatchObject({ status: 'pending', paymentMethod: 'cod', method: 'pickup', total: 2000, lineCount: 1, paymentStatus: 'pending' });
    expect(JSON.stringify(body)).not.toContain(other.number);
    expect(((await (await list(b.auth)).json()) as { items: Summary[] }).items.map((o) => o.number)).toEqual([other.number]);
  });

  it('pages the list and bounds the page size', async () => {
    const a = await newShopper(app, base, 'histpage');
    const one = await place(a, 1000, 'hist-page-order-1');
    const two = await place(a, 1000, 'hist-page-order-2');
    const p1 = (await (await list(a.auth, '?limit=1&page=1')).json()) as { items: Summary[]; total: number; limit: number; page: number };
    const p2 = (await (await list(a.auth, '?limit=1&page=2')).json()) as { items: Summary[] };
    expect(p1.items.map((o) => o.number)).toEqual([two.number]);
    expect(p2.items.map((o) => o.number)).toEqual([one.number]);
    expect(p1).toMatchObject({ total: 2, limit: 1, page: 1 });
    expect((await list(a.auth, '?limit=500')).status).toBe(400);
    expect((await list(a.auth, '?limit=0')).status).toBe(400);
    expect((await list(a.auth, '?page=0')).status).toBe(400);
    const none = (await (await list(a.auth, '?page=9')).json()) as { items: Summary[] };
    expect(none.items).toEqual([]);
  });

  it('shows an empty list to a customer with no orders', async () => {
    const a = await newShopper(app, base, 'histnone');
    expect(await (await list(a.auth)).json()).toMatchObject({ items: [], total: 0 });
  });

  it('opens an order with its lines, totals, payment and timeline, under the account\'s own name and email', async () => {
    const a = await newShopper(app, base, 'histdetail');
    const o = await place(a, 1500, 'hist-detail-order-1', 2);
    const res = await detail(a.auth, o.number);
    expect(res.status).toBe(200);
    const d = (await res.json()) as Detail;
    expect(d).toMatchObject({ number: o.number, status: 'pending', subtotal: 3000, discount: 0, deliveryFee: 0, total: 3000, vat: null });
    expect(d.lines).toEqual([expect.objectContaining({ name: o.name, colour: 'E2E Black', size: '42', qty: 2, unitPrice: 1500, lineTotal: 3000 })]);
    expect(d.payments).toEqual([expect.objectContaining({ provider: 'cod', status: 'pending', amount: 3000 })]);
    expect(d.timeline[0]).toMatchObject({ type: 'created' });
    expect(d.customer).toMatchObject({ name: 'Shopper histdetail' });
    expect(d.customer.email).toMatch(/^histdetail\.\d+@example\.com$/);
  });

  it('never exposes staff-only fields on the order', async () => {
    const a = await newShopper(app, base, 'histprivate');
    const o = await place(a, 1500, 'hist-private-order-1');
    const text = await (await detail(a.auth, o.number)).text();
    for (const secret of ['providerRef', 'actorId', 'stockCommitted', 'allowedTransitions', 'idempotencyKey', 'reservationExpiresAt']) {
      expect(text).not.toContain(secret);
    }
  });

  it('includes the VAT fixed when the order was placed', async () => {
    await setSetting(base, staff, 'vat', VAT_ON);
    const a = await newShopper(app, base, 'histvat');
    const o = await place(a, 1160, 'hist-vat-order-001');
    await setSetting(base, staff, 'vat', VAT_OFF);
    const d = (await (await detail(a.auth, o.number)).json()) as Detail;
    expect(d.vat).toMatchObject({ ratePercent: 16, amount: 160, net: 1000, seller: { businessName: VAT_ON.businessName, kraPin: VAT_ON.kraPin } });
  });

  it('answers 404 for someone else\'s order and for an unknown number, and accepts the number in lower case', async () => {
    const a = await newShopper(app, base, 'histowner');
    const b = await newShopper(app, base, 'histsnoop');
    const o = await place(a, 1000, 'hist-owner-order-01');
    expect((await detail(b.auth, o.number)).status).toBe(404);
    expect((await detail(a.auth, 'JB-999999')).status).toBe(404);
    expect((await detail(a.auth, o.number.toLowerCase())).status).toBe(200);
  });

  it('needs a customer token', async () => {
    const a = await newShopper(app, base, 'histauth');
    const o = await place(a, 1000, 'hist-auth-order-001');
    expect((await fetch(`${base}/store/me/orders`)).status).toBe(401);
    expect((await fetch(`${base}/store/me/orders/${o.number}`)).status).toBe(401);
    expect((await list(staff)).status).toBe(401);
    expect((await detail(staff, o.number)).status).toBe(401);
    const r = await fetch(`${base}/store/me/orders`, json({}, a.auth));
    expect(r.status).toBe(404);
  });
});
