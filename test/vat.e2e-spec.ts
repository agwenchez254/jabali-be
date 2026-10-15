import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service';
import { extractVat } from '../src/orders/vat';
import { bootApp, json } from './helpers/app';
import { newShopper, placePickupOrder, seedVariant, setSetting, staffAuth, VAT_OFF, VAT_ON } from './helpers/shop';

jest.setTimeout(90_000);

type Vat = { ratePercent: number; amount: number; net: number; seller: { businessName: string; kraPin: string; address: string } } | null;
type PlacedBody = { order: { id: string; total: number; vat: Vat } };

describe('VAT on orders', () => {
  let app: NestFastifyApplication;
  let base: string;
  let staff: Record<string, string>;

  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
    staff = await staffAuth(base);
  });
  afterAll(async () => {
    await app.close();
  });

  it('takes VAT out of the price at the configured rate and keeps the seller details on the order', async () => {
    expect((await setSetting(base, staff, 'vat', VAT_ON)).status).toBe(200);
    const { variantId } = await seedVariant(app, 1160);
    const who = await newShopper(app, base, 'vaton');
    const res = await placePickupOrder(base, who, variantId, 'vat-on-key-0001');
    expect(res.status).toBe(201);
    const { order } = (await res.json()) as PlacedBody;
    const expected = extractVat(order.total, 16);
    expect(order.total).toBe(1160);
    expect(order.vat).toEqual({ ratePercent: 16, amount: expected.vat, net: expected.net, seller: { businessName: VAT_ON.businessName, kraPin: VAT_ON.kraPin, address: VAT_ON.address } });
    expect(order.vat?.amount).toBe(160);
    const row = await app.get(PrismaService).order.findUnique({ where: { id: order.id } });
    expect(row).toMatchObject({ vatRateBp: 1600, vatAmount: 160 });
  });

  it('leaves an order untouched when the rate changes or VAT is switched off later', async () => {
    await setSetting(base, staff, 'vat', VAT_ON);
    const { variantId } = await seedVariant(app, 2320);
    const who = await newShopper(app, base, 'vatlater');
    const first = (await (await placePickupOrder(base, who, variantId, 'vat-later-key-1')).json()) as PlacedBody;
    await setSetting(base, staff, 'vat', { ...VAT_ON, ratePercent: 8, businessName: 'Renamed Ltd' });
    await setSetting(base, staff, 'vat', VAT_OFF);
    const replay = await placePickupOrder(base, who, variantId, 'vat-later-key-1');
    expect(replay.status).toBe(200);
    const again = (await replay.json()) as PlacedBody;
    expect(again.order.vat).toEqual(first.order.vat);
    expect(again.order.vat?.ratePercent).toBe(16);
    expect(again.order.vat?.seller.businessName).toBe(VAT_ON.businessName);
  });

  it('records no VAT on an order placed while VAT is off', async () => {
    await setSetting(base, staff, 'vat', VAT_OFF);
    const { variantId } = await seedVariant(app, 900);
    const who = await newShopper(app, base, 'vatoff');
    const { order } = (await (await placePickupOrder(base, who, variantId, 'vat-off-key-0001')).json()) as PlacedBody;
    expect(order.vat).toBeNull();
    const row = await app.get(PrismaService).order.findUnique({ where: { id: order.id } });
    expect(row).toMatchObject({ vatRateBp: null, vatAmount: null, vatSeller: null });
  });

  it('shows the VAT included in a cart quote only while VAT is on', async () => {
    const { variantId } = await seedVariant(app, 1160);
    const quote = async () =>
      (await (await fetch(`${base}/store/cart/quote`, json({ lines: [{ variantId, qty: 1 }], method: 'pickup' }))).json()) as { total: number; vat: { ratePercent: number; amount: number } | null };
    await setSetting(base, staff, 'vat', VAT_ON);
    expect((await quote()).vat).toEqual({ ratePercent: 16, amount: 160 });
    await setSetting(base, staff, 'vat', VAT_OFF);
    expect((await quote()).vat).toBeNull();
  });

  it('refuses to enable VAT without a valid KRA PIN', async () => {
    const r = await setSetting(base, staff, 'vat', { ...VAT_ON, kraPin: 'nope' });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { errors?: { field: string }[] };
    expect(body.errors?.some((e) => e.field.endsWith('kraPin'))).toBe(true);
  });

  it('keeps the KRA PIN and address out of the public settings and home responses', async () => {
    await setSetting(base, staff, 'vat', VAT_ON);
    for (const path of ['/store/settings', '/store/home']) {
      const text = await (await fetch(`${base}${path}`)).text();
      expect(text).not.toContain(VAT_ON.kraPin);
      expect(text).not.toContain('Moi Avenue');
      expect(text).not.toContain(VAT_ON.businessName);
    }
    const settings = (await (await fetch(`${base}/store/settings`)).json()) as { vat?: unknown };
    expect(settings.vat).toEqual({ enabled: true, ratePercent: 16 });
    await setSetting(base, staff, 'vat', VAT_OFF);
  });
});
