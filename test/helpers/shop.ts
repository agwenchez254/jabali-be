import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from '../global-setup';
import { json } from './app';
import { registerVerified } from './auth';

/** Creates an active product with one size in stock and returns the variant to order. */
export async function seedVariant(app: NestFastifyApplication, price: number, stock = 50): Promise<{ variantId: string; name: string }> {
  const prisma = app.get(PrismaService);
  const tag = randomUUID().slice(0, 8);
  const category = await prisma.category.upsert({
    where: { gender_slug: { gender: 'men', slug: 'e2e-shop' } },
    update: {},
    create: { gender: 'men', slug: 'e2e-shop', label: 'E2E shop' },
  });
  const colour = await prisma.colour.upsert({ where: { name: 'E2E Black' }, update: {}, create: { name: 'E2E Black', hex: '#000000' } });
  const name = `E2E Loafer ${tag}`;
  const product = await prisma.product.create({
    data: { slug: `e2e-loafer-${tag}`, name, gender: 'men', categoryId: category.id, basePrice: price, status: 'active' },
  });
  const variant = await prisma.variant.create({ data: { productId: product.id, colourId: colour.id, size: '42', sku: `E2E-${tag}` } });
  await prisma.inventory.create({ data: { variantId: variant.id, onHand: stock } });
  return { variantId: variant.id, name };
}

export async function staffAuth(base: string): Promise<Record<string, string>> {
  const login = await fetch(`${base}/admin/auth/login`, json({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }));
  const { accessToken } = (await login.json()) as { accessToken: string };
  return { authorization: `Bearer ${accessToken}` };
}

export const setSetting = (base: string, staff: Record<string, string>, key: string, value: unknown) =>
  fetch(`${base}/admin/settings/${key}`, json({ value }, staff, 'PUT'));

export const VAT_ON = { enabled: true, ratePercent: 16, businessName: 'Jabali Menswear Ltd', kraPin: 'P051234567Z', address: 'Moi Avenue, Nairobi' };
export const VAT_OFF = { enabled: false, ratePercent: 16, businessName: '', kraPin: '', address: '' };

export interface Shopper {
  accessToken: string;
  auth: Record<string, string>;
}

let seq = 0;
/** A verified customer with a unique email and phone. */
export async function newShopper(app: NestFastifyApplication, base: string, label = 'shopper'): Promise<Shopper> {
  const n = ++seq + Math.floor(Math.random() * 1000) * 100;
  const s = await registerVerified(app, base, {
    name: `Shopper ${label}`,
    email: `${label}.${n}@example.com`,
    phone: `07${String(40000000 + n).slice(-8)}`,
    password: 'Sunrise-over-Nairobi-42',
  });
  return { accessToken: s.accessToken, auth: { authorization: `Bearer ${s.accessToken}` } };
}

/** Collect-in-store, pay-on-delivery order: no delivery fee and no payment provider involved. */
export const placePickupOrder = (base: string, who: Shopper, variantId: string, key: string, qty = 1) =>
  fetch(`${base}/store/orders`, json({ lines: [{ variantId, qty }], method: 'pickup', paymentMethod: 'cod' }, { ...who.auth, 'idempotency-key': key }));
