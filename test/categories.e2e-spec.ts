import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { bootApp, json } from './helpers/app';
import { staffAuth } from './helpers/shop';

jest.setTimeout(60_000);

interface Cat { id: string; slug: string; label: string; gender: string; productCount: number; parentId: string | null }
interface Problem { status: number; code?: string; detail?: string }

describe('Category CRUD', () => {
  let app: NestFastifyApplication;
  let base: string;
  let auth: Record<string, string>;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 6);
  const made: string[] = [];

  const create = async (body: Record<string, unknown>) => {
    const r = await fetch(`${base}/admin/categories`, json(body, auth));
    const b = (await r.json()) as Cat & Problem;
    if (r.status === 201) made.push(b.id);
    return { status: r.status, body: b };
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`${base}/admin/categories/${id}`, json(body, auth, 'PATCH'));
    return { status: r.status, body: (await r.json()) as Cat & Problem };
  };
  const del = async (id: string) => {
    const r = await fetch(`${base}/admin/categories/${id}`, { method: 'DELETE', headers: auth });
    return { status: r.status, body: r.status === 204 ? ({} as Problem) : ((await r.json()) as Problem) };
  };
  const productIn = (categoryId: string, deletedAt: Date | null = null) =>
    prisma.product.create({ data: { slug: `cat-p-${randomUUID().slice(0, 8)}`, name: 'Cat product', gender: 'men', categoryId, basePrice: 1000, status: 'draft', deletedAt } });

  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
    auth = await staffAuth(base);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await prisma.product.deleteMany({ where: { categoryId: { in: made } } });
    await prisma.category.deleteMany({ where: { id: { in: made } } });
    await app.close();
  });

  it('creates, lists and edits a category', async () => {
    const c = await create({ gender: 'men', label: `Boots ${tag}`, tagline: 'Built to last', sortOrder: 3 });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ slug: `boots-${tag}`, tagline: 'Built to last', productCount: 0 });
    const list = (await (await fetch(`${base}/admin/categories?gender=men`, { headers: auth })).json()) as Cat[];
    expect(list.some((x) => x.id === c.body.id)).toBe(true);
    const u = await patch(c.body.id, { label: `Boots and more ${tag}`, tagline: '' });
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ label: `Boots and more ${tag}`, tagline: '', slug: `boots-${tag}` });
  });

  it('refuses a duplicate slug in the same section on create and on edit, but allows it in the other section', async () => {
    const a = await create({ gender: 'men', label: `Sandals ${tag}` });
    expect((await create({ gender: 'men', label: `Sandals ${tag}` })).status).toBe(409);
    expect((await create({ gender: 'women', label: `Sandals ${tag}` })).status).toBe(201);
    const b = await create({ gender: 'men', label: `Slides ${tag}` });
    expect((await patch(b.body.id, { slug: a.body.slug })).status).toBe(409);
    expect((await patch(b.body.id, { slug: b.body.slug })).status).toBe(200);
  });

  it('answers 404 for editing or deleting a category that does not exist', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await patch(ghost, { label: 'x' })).status).toBe(404);
    expect((await del(ghost)).status).toBe(404);
  });

  it('cannot delete a category that is assigned to products, and says how many', async () => {
    const c = await create({ gender: 'men', label: `Loafers ${tag}` });
    await productIn(c.body.id);
    await productIn(c.body.id);
    const r = await del(c.body.id);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('category_in_use');
    expect(r.body.detail).toContain('2 products');
    expect((await prisma.category.count({ where: { id: c.body.id } }))).toBe(1);
  });

  it('can delete it once the products have moved to another category', async () => {
    const from = await create({ gender: 'men', label: `Old ${tag}` });
    const to = await create({ gender: 'men', label: `New ${tag}` });
    const p = await productIn(from.body.id);
    expect((await del(from.body.id)).status).toBe(409);
    await prisma.product.update({ where: { id: p.id }, data: { categoryId: to.body.id } });
    expect((await del(from.body.id)).status).toBe(204);
    expect(await prisma.category.count({ where: { id: from.body.id } })).toBe(0);
  });

  it('still refuses when only deleted products point at it, with an honest message', async () => {
    const c = await create({ gender: 'men', label: `Ghosts ${tag}` });
    await productIn(c.body.id, new Date());
    const r = await del(c.body.id);
    expect(r.status).toBe(409);
    expect(r.body.detail).toContain('deleted');
  });

  it('cannot delete a category that has subcategories', async () => {
    const parent = await create({ gender: 'men', label: `Shoes ${tag}` });
    const child = await create({ gender: 'men', label: `Trainers ${tag}`, parentId: parent.body.id });
    expect(child.body.parentId).toBe(parent.body.id);
    expect((await del(parent.body.id)).status).toBe(409);
    expect((await del(child.body.id)).status).toBe(204);
    expect((await del(parent.body.id)).status).toBe(204);
  });

  it('rejects a parent that is itself, in another section, unknown, or a descendant', async () => {
    const a = await create({ gender: 'men', label: `A ${tag}` });
    const b = await create({ gender: 'men', label: `B ${tag}`, parentId: a.body.id });
    const w = await create({ gender: 'women', label: `W ${tag}` });
    expect((await patch(a.body.id, { parentId: a.body.id })).status).toBe(400);
    expect((await patch(a.body.id, { parentId: b.body.id })).status).toBe(400);
    expect((await patch(b.body.id, { parentId: w.body.id })).status).toBe(400);
    expect((await patch(b.body.id, { parentId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await create({ gender: 'men', label: `C ${tag}`, parentId: w.body.id })).status).toBe(400);
    expect((await patch(b.body.id, { parentId: null })).body.parentId).toBeNull();
  });

  it('keeps a category with products in its section', async () => {
    const c = await create({ gender: 'men', label: `Fixed ${tag}` });
    await productIn(c.body.id);
    expect((await patch(c.body.id, { gender: 'women' })).status).toBe(409);
    const empty = await create({ gender: 'men', label: `Free ${tag}` });
    expect((await patch(empty.body.id, { gender: 'women' })).body.gender).toBe('women');
  });

  it('validates the body and requires authentication', async () => {
    expect((await create({ gender: 'men', label: '' })).status).toBe(400);
    expect((await create({ gender: 'kids', label: 'x' })).status).toBe(400);
    expect((await create({ gender: 'men', label: 'x', slug: 'Bad Slug' })).status).toBe(400);
    expect((await fetch(`${base}/admin/categories`, json({ gender: 'men', label: 'x' }))).status).toBe(401);
  });
});
