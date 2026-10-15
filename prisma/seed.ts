/**
 * Idempotent seed: safe to run repeatedly. It never overwrites data that staff may have edited
 * (existing products, content blocks, promotions, settings are left alone).
 */
import { Gender, Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedAccess } from './seed-lib';

try {
  process.loadEnvFile();
} catch {
  /* rely on process env */
}

const prisma = new PrismaClient();

interface SeedProduct {
  slug: string;
  name: string;
  gender: Gender;
  category: string;
  price: number;
  compareAt: number | null;
  colours: { name: string; hex: string }[];
  sizes: string[];
  images: string[];
  colourImages: Record<string, string[]>;
  bestseller: boolean;
  isNew: boolean;
  rating: number;
  sold: number;
  stock: number;
  blurb: string;
}
interface SeedCategory {
  gender: Gender;
  slug: string;
  label: string;
  tagline: string;
  image: string;
  sortOrder: number;
}
const data = JSON.parse(readFileSync(join(__dirname, 'seed-data', 'catalogue.json'), 'utf8')) as {
  categories: SeedCategory[];
  products: SeedProduct[];
};

const ADMIN_EMAIL = 'admin@jabali.co.ke';
const img = (id: string, w = 1000) => `https://images.unsplash.com/photo-${id}?w=${w}&q=75&auto=format&fit=crop`;

/** Ported from gift-shoe-app/src/data/delivery.ts (duplicate counties removed). */
const ZONES = [
  { code: 'nairobi', name: 'Nairobi', fee: 250, etaDays: 1, eta: 'Same-day if ordered before 2 pm, otherwise next day', counties: ['Nairobi'] },
  { code: 'metro', name: 'Nairobi metro', fee: 350, etaDays: 2, eta: '1 to 2 working days', counties: ['Kiambu', 'Kajiado', 'Machakos', "Murang'a"] },
  {
    code: 'regional',
    name: 'Major towns',
    fee: 450,
    etaDays: 3,
    eta: '2 to 3 working days',
    counties: ['Mombasa', 'Kisumu', 'Nakuru', 'Uasin Gishu', 'Nyeri', 'Meru', 'Kisii', 'Kakamega', 'Kilifi', 'Embu', 'Laikipia', 'Bungoma'],
  },
  {
    code: 'far',
    name: 'Other counties',
    fee: 650,
    etaDays: 5,
    eta: '3 to 5 working days',
    counties: [
      'Garissa', 'Isiolo', 'Kitui', 'Makueni', 'Nandi', 'Narok', 'Turkana', 'Kericho', 'Bomet', 'Migori', 'Homa Bay', 'Siaya', 'Busia', 'Vihiga',
      'Trans Nzoia', 'Baringo', 'Taita Taveta', 'Lamu', 'Tana River', 'Marsabit', 'Wajir', 'Mandera', 'Samburu', 'West Pokot', 'Elgeyo Marakwet',
      'Nyandarua', 'Nyamira', 'Kirinyaga', 'Tharaka Nithi', 'Kwale',
    ],
  },
];

const TESTIMONIALS: { name: string; location: string; quote: string; gender: Gender; isLead: boolean }[] = [
  { gender: 'men', isLead: true, name: 'Kelvin Mutiso', location: 'Machakos', quote: 'Ordered the charcoal suit on Tuesday for my brother’s wedding. It reached Machakos on Thursday and fit perfectly.' },
  { gender: 'men', isLead: false, name: 'Achieng’ Odhiambo', location: 'Kisumu', quote: 'The gift box opening on his phone had my husband grinning before he touched the shirt.' },
  { gender: 'men', isLead: false, name: 'Mwangi Gathogo', location: 'Kilimani, Nairobi', quote: 'Paid by M-Pesa in under a minute. The Oxfords came boxed and polished.' },
  { gender: 'men', isLead: false, name: 'Otieno Ouma', location: 'Kakamega', quote: 'Sizing guide was spot on. The Kaunda suit needed no alterations before the ceremony.' },
  { gender: 'men', isLead: false, name: 'Brian Kiprop', location: 'Nyeri', quote: 'Wrapped, carded and delivered to my dad in Nyeri the next day. He kept the box.' },
  { gender: 'men', isLead: false, name: 'Hassan Abdi', location: 'Eastleigh, Nairobi', quote: 'Third order now. The shirts hold their shape wash after wash.' },
  { gender: 'women', isLead: true, name: 'Naliaka Wekesa', location: 'Eldoret', quote: 'The denim shirt dress reached Eldoret in two days and fits like it was made for me.' },
  { gender: 'women', isLead: false, name: 'Zawadi Mwikali', location: 'Mombasa', quote: 'I paid by M-Pesa from my desk. The coat was at my door by Friday.' },
  { gender: 'women', isLead: false, name: 'Amina Said', location: 'South B, Nairobi', quote: 'The gift reveal made my sister cry on a video call, in the best way.' },
  { gender: 'women', isLead: false, name: 'Cynthia Chebet', location: 'Nakuru', quote: 'Bought two dresses for a family trip. Both arrived pressed and perfectly packed.' },
  { gender: 'women', isLead: false, name: 'Faith Njoroge', location: 'Thika', quote: 'Customer care answered on WhatsApp within minutes and sorted my exchange.' },
  { gender: 'women', isLead: false, name: 'Lilian Atieno', location: 'Kisii', quote: 'The knitwear is softer than anything I have found in town. Already ordered another.' },
];

const trust = (alterations: string) => [
  { icon: 'phone', title: 'Pay with M-Pesa', text: 'STK push to your phone. No card needed.' },
  { icon: 'package', title: 'Delivery nationwide', text: 'Same-day in Nairobi, up to 5 days upcountry.' },
  { icon: 'ruler', title: alterations === 'men' ? 'Free alterations' : 'Free hemming', text: alterations === 'men' ? 'Suits hemmed at our CBD studio.' : 'Dresses and trousers adjusted at our studio.' },
  { icon: 'hand-coins', title: 'Pay on delivery', text: 'Available in Nairobi. Try before you pay.' },
];

const BLOCKS: { key: string; kind: Prisma.ContentBlockCreateInput['kind']; gender: Gender; data: Prisma.InputJsonValue }[] = [
  {
    key: 'home.hero.men',
    kind: 'hero',
    gender: 'men',
    data: {
      lines: ['Sharp suits.', 'Sent anywhere.'],
      sub: 'Tailored menswear for Kenyan life, from Nairobi boardrooms to Kisumu weddings. Pay with M-Pesa and get it delivered fast.',
      cta: 'Shop menswear',
      image: img('1593032465175-481ac7f401a0', 1600),
      alt: 'Man adjusting the button of a forest green suit',
      focalPoint: '50% 22%',
      featuredProductSlug: 'three-piece-wedding-suit',
    },
  },
  {
    key: 'home.hero.women',
    kind: 'hero',
    gender: 'women',
    data: {
      lines: ['Wear what', 'feels like you.'],
      sub: 'Dresses, tailoring and everyday basics for Kenyan women. Pay with M-Pesa and get it delivered to your door.',
      cta: 'Shop womenswear',
      image: img('1572804013309-59a88b7e92f1', 1600),
      alt: 'Woman smiling in a red floral dress against a warm yellow wall',
      focalPoint: '50% 30%',
      featuredProductSlug: 'floral-wrap-dress',
    },
  },
  { key: 'home.trust.men', kind: 'banner', gender: 'men', data: { items: trust('men') } },
  { key: 'home.trust.women', kind: 'banner', gender: 'women', data: { items: trust('women') } },
  { key: 'home.sections.men', kind: 'rich_text', gender: 'men', data: { categoriesTitle: 'Start with what you need', topProductsTitle: 'What Nairobi is wearing' } },
  { key: 'home.sections.women', kind: 'rich_text', gender: 'women', data: { categoriesTitle: 'Find your next favourite', topProductsTitle: 'What Nairobi is loving' } },
  {
    key: 'home.gift.men',
    kind: 'gift_promo',
    gender: 'men',
    data: { productSlug: 'oxford-button-down', colour: 'White', wrap: 'forest', ribbon: 'gold', message: 'Congratulations on the new job. Wear it well.', from: 'Wanjiru', to: 'Baba' },
  },
  {
    key: 'home.gift.women',
    kind: 'gift_promo',
    gender: 'women',
    data: { productSlug: 'denim-shirt-dress', colour: 'Denim', wrap: 'midnight', ribbon: 'cream', message: 'Happy birthday, mama. You deserve something lovely.', from: 'Njeri', to: 'Mama' },
  },
];

const mediaCache = new Map<string, string>();
async function mediaFor(url: string, alt = ''): Promise<string> {
  const hit = mediaCache.get(url);
  if (hit) return hit;
  const key = `ext-${createHash('sha1').update(url).digest('hex')}`;
  const m = await prisma.media.upsert({ where: { key }, update: {}, create: { key, url, mime: 'image/jpeg', alt } });
  mediaCache.set(url, m.id);
  return m.id;
}

async function main(): Promise<void> {
  // ---- access: roles, permissions, owner
  const envPw = process.env.SEED_ADMIN_PASSWORD;
  const generated = envPw ? null : randomBytes(18).toString('base64url');
  const password = envPw ?? (generated as string);
  const ownerExisted = !!(await prisma.staffUser.findUnique({ where: { email: ADMIN_EMAIL } }));
  await seedAccess(prisma, { email: ADMIN_EMAIL, password, name: 'Jabali Owner' });
  if (!ownerExisted) {
    console.log(`\nOwner account created: ${ADMIN_EMAIL}`);
    console.log(generated ? `Generated password (shown once, store it now): ${generated}\n` : 'Password taken from SEED_ADMIN_PASSWORD.\n');
  } else {
    console.log(`Owner ${ADMIN_EMAIL} already exists; password left unchanged.`);
  }

  // ---- colours
  const colourIds = new Map<string, string>();
  for (const p of data.products) {
    for (const c of p.colours) {
      if (colourIds.has(c.name)) continue;
      const row = await prisma.colour.upsert({ where: { name: c.name }, update: {}, create: { name: c.name, hex: c.hex } });
      colourIds.set(c.name, row.id);
    }
  }

  // ---- categories
  const categoryIds = new Map<string, string>();
  for (const c of data.categories) {
    const imageId = await mediaFor(c.image, c.label);
    const row = await prisma.category.upsert({
      where: { gender_slug: { gender: c.gender, slug: c.slug } },
      update: {},
      create: { gender: c.gender, slug: c.slug, label: c.label, tagline: c.tagline, sortOrder: c.sortOrder, imageId },
    });
    categoryIds.set(`${c.gender}:${c.slug}`, row.id);
  }

  // ---- delivery zones
  for (const [i, z] of ZONES.entries()) {
    await prisma.deliveryZone.upsert({ where: { code: z.code }, update: {}, create: { ...z, sortOrder: i } });
  }

  // ---- products
  const skus = new Set((await prisma.variant.findMany({ select: { sku: true } })).map((v) => v.sku));
  let created = 0;
  for (const p of data.products) {
    if (await prisma.product.findUnique({ where: { slug: p.slug } })) continue;
    const categoryId = categoryIds.get(`${p.gender}:${p.category}`);
    if (!categoryId) throw new Error(`Unknown category ${p.gender}:${p.category} for ${p.slug}`);
    const product = await prisma.product.create({
      data: {
        slug: p.slug,
        name: p.name,
        gender: p.gender,
        categoryId,
        blurb: p.blurb,
        basePrice: p.price,
        compareAtPrice: p.compareAt,
        status: 'active',
        isNew: p.isNew,
        isBestseller: p.bestseller,
        ratingAvg: p.rating,
        soldCount: p.sold,
        colours: { create: p.colours.map((c, sortOrder) => ({ colourId: colourIds.get(c.name) as string, sortOrder })) },
      },
    });
    // shared gallery (fallback for colours without their own photos)
    const imageRows: Prisma.ProductImageCreateManyInput[] = [];
    for (const [position, url] of p.images.entries()) {
      imageRows.push({ productId: product.id, colourId: null, mediaId: await mediaFor(url, p.name), position, alt: p.name });
    }
    // per-colour galleries from the prototype's `colorImages`
    for (const [colourName, urls] of Object.entries(p.colourImages)) {
      const colourId = colourIds.get(colourName);
      if (!colourId || !p.colours.some((c) => c.name === colourName)) continue;
      for (const [position, url] of urls.entries()) {
        imageRows.push({ productId: product.id, colourId, mediaId: await mediaFor(url, `${p.name} in ${colourName}`), position, alt: `${p.name} in ${colourName}` });
      }
    }
    await prisma.productImage.createMany({ data: imageRows });
    // variant grid: colour x size, each with the prototype's stock figure
    for (const c of p.colours) {
      for (const size of p.sizes) {
        const base = `${p.slug.toUpperCase().replace(/-/g, '').slice(0, 10)}-${c.name.toUpperCase().slice(0, 3)}-${size.toUpperCase().replace(/\s/g, '')}`;
        let sku = base;
        for (let n = 2; skus.has(sku); n++) sku = `${base}-${n}`;
        skus.add(sku);
        const v = await prisma.variant.create({
          data: { productId: product.id, colourId: colourIds.get(c.name) as string, size, sku, inventory: { create: { onHand: p.stock, reserved: 0 } } },
        });
        await prisma.inventoryMovement.create({ data: { variantId: v.id, delta: p.stock, reason: 'restock', note: 'Seed stock' } });
      }
    }
    created++;
  }

  // ---- testimonials
  if ((await prisma.testimonial.count()) === 0) {
    await prisma.testimonial.createMany({ data: TESTIMONIALS.map((t, sortOrder) => ({ ...t, sortOrder, rating: 5 })) });
  }

  // ---- promotions
  const promos: Prisma.PromotionCreateInput[] = [
    { name: 'Welcome 10% off', code: 'WELCOME10', type: 'percent', value: 10, status: 'active', perCustomerLimit: 1, targets: { create: [{ targetType: 'all' }] } },
    { name: 'Free delivery over KES 5,000', code: 'FREESHIP', type: 'free_delivery', value: 0, status: 'active', minSubtotal: 5000, stackable: true, targets: { create: [{ targetType: 'all' }] } },
  ];
  for (const p of promos) {
    if (!(await prisma.promotion.findUnique({ where: { code: p.code as string } }))) await prisma.promotion.create({ data: p });
  }
  const tees = categoryIds.get('men:tshirts');
  if (tees && !(await prisma.promotion.findUnique({ where: { code: 'TEE2FOR1' } }))) {
    await prisma.promotion.create({
      data: { name: 'T-shirts: buy one get one free', code: 'TEE2FOR1', type: 'bogo', value: 0, status: 'draft', targets: { create: [{ targetType: 'category', targetId: tees }] } },
    });
  }

  // ---- site settings
  const settings: Record<string, Prisma.InputJsonValue | null> = {
    freeDeliveryThreshold: null,
    whatsappNumber: '',
    pickupAddress: 'Jabali Studio, 2nd Floor, Kimathi House, Kimathi Street, Nairobi CBD',
    announcementBar: { enabled: false, text: '' },
    paymentMethods: ['cod', 'mpesa'],
    giftFee: 350,
    codZoneCodes: ['nairobi'],
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.siteSetting.upsert({ where: { key }, update: {}, create: { key, value: value ?? Prisma.JsonNull } });
  }

  // ---- content blocks (published, version 1)
  for (const b of BLOCKS) {
    if (await prisma.contentBlock.findUnique({ where: { key: b.key } })) continue;
    await prisma.contentBlock.create({ data: { key: b.key, kind: b.kind, gender: b.gender, data: b.data, status: 'published', version: 1 } });
  }

  console.log(
    `Seed complete: ${created} new products (${await prisma.product.count()} total), ${await prisma.category.count()} categories, ` +
      `${await prisma.colour.count()} colours, ${await prisma.deliveryZone.count()} zones, ${await prisma.promotion.count()} promotions.`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
