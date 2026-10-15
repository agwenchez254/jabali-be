import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { bootApp, json } from './helpers/app';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './global-setup';

jest.setTimeout(60_000);

// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('Fastify platform behaviour', () => {
  let app: NestFastifyApplication;
  let base: string;
  let auth: Record<string, string>;
  let refreshCookie: string;

  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false', MAX_UPLOAD_MB: '1' }));
    const login = await fetch(`${base}/admin/auth/login`, json({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }));
    expect(login.status).toBe(200);
    refreshCookie = (login.headers.getSetCookie().find((c) => c.startsWith('jabali_rt=')) ?? '').split(';')[0];
    const { accessToken } = (await login.json()) as { accessToken: string };
    auth = { authorization: `Bearer ${accessToken}` };
  });
  afterAll(async () => {
    await app.close();
  });

  describe('refresh cookie', () => {
    it('sets an httpOnly cookie scoped to the auth routes on login', async () => {
      const login = await fetch(`${base}/admin/auth/login`, json({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }));
      const cookie = login.headers.getSetCookie().find((c) => c.startsWith('jabali_rt='));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/admin\/auth/);
    });

    it('rotates the session from the cookie alone, with no body at all', async () => {
      const r = await fetch(`${base}/admin/auth/refresh`, { method: 'POST', headers: { cookie: refreshCookie } });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { accessToken?: string };
      expect(body.accessToken).toBeTruthy();
      refreshCookie = (r.headers.getSetCookie().find((c) => c.startsWith('jabali_rt=')) ?? '').split(';')[0];
      expect(refreshCookie).not.toBe('');
    });

    it('accepts Content-Type: application/json with an empty body, and clears the cookie on logout', async () => {
      const r = await fetch(`${base}/admin/auth/logout`, { method: 'POST', headers: { cookie: refreshCookie, 'content-type': 'application/json' } });
      expect(r.status).toBe(204);
      expect(r.headers.getSetCookie().find((c) => c.startsWith('jabali_rt='))).toMatch(/jabali_rt=;|Expires=Thu, 01 Jan 1970/i);
      const again = await fetch(`${base}/admin/auth/refresh`, { method: 'POST', headers: { cookie: refreshCookie } });
      expect(again.status).toBe(401);
    });
  });

  describe('media upload (multipart)', () => {
    const form = (file: Buffer | null, alt?: string) => {
      const f = new FormData();
      if (alt !== undefined) f.append('alt', alt);
      if (file) f.append('file', new Blob([new Uint8Array(file)], { type: 'image/png' }), 'dot.png');
      return f;
    };
    const upload = (f: FormData) => fetch(`${base}/admin/media`, { method: 'POST', headers: auth, body: f });

    it('stores an image and its alt text, and serves it back', async () => {
      const r = await upload(form(PNG, 'a dot'));
      expect(r.status).toBe(201);
      const m = (await r.json()) as { id: string; url: string; alt: string; mime: string; bytes: number };
      expect(m).toMatchObject({ alt: 'a dot', mime: 'image/png', bytes: PNG.length });
      const served = await fetch(m.url.replace(/^https?:\/\/[^/]+/, base.replace('/api/v1', '')));
      expect(served.status).toBe(200);
      expect(served.headers.get('x-content-type-options')).toBe('nosniff');
      await fetch(`${base}/admin/media/${m.id}`, { method: 'DELETE', headers: auth });
    });

    it('defaults the alt text to empty when none is sent', async () => {
      const r = await upload(form(PNG));
      expect(r.status).toBe(201);
      const m = (await r.json()) as { id: string; alt: string };
      expect(m.alt).toBe('');
      await fetch(`${base}/admin/media/${m.id}`, { method: 'DELETE', headers: auth });
    });

    it('refuses a request with no file with 415', async () => {
      expect((await upload(form(null, 'x'))).status).toBe(415);
      const r = await fetch(`${base}/admin/media`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
      expect(r.status).toBe(415);
    });

    it('refuses something that is not an image with 415', async () => {
      expect((await upload(form(Buffer.from('<script>alert(1)</script>')))).status).toBe(415);
    });

    it('refuses a file over the size limit with 413 as problem+json', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]);
      const r = await upload(form(big));
      expect(r.status).toBe(413);
      expect(r.headers.get('content-type')).toContain('application/problem+json');
    });

    it('refuses an over-long alt text with 400', async () => {
      const r = await upload(form(PNG, 'x'.repeat(201)));
      expect(r.status).toBe(400);
      expect(((await r.json()) as { code?: string }).code).toBe('validation_failed');
    });

    it('requires authentication', async () => {
      const r = await fetch(`${base}/admin/media`, { method: 'POST', body: form(PNG) });
      expect(r.status).toBe(401);
    });
  });

  describe('media batch upload (multipart)', () => {
    type Item = { id: string; alt: string; mime: string };
    type Failure = { index: number; filename: string; status: number; message: string };
    const blob = (b: Buffer) => new Blob([new Uint8Array(b)], { type: 'image/png' });
    const batch = (f: FormData, headers: Record<string, string> = auth) => fetch(`${base}/admin/media/batch`, { method: 'POST', headers, body: f });
    const cleanup = (items: Item[]) => Promise.all(items.map((m) => fetch(`${base}/admin/media/${m.id}`, { method: 'DELETE', headers: auth })));

    it('stores several images in one request, with alt text matched to the file before it', async () => {
      const f = new FormData();
      f.append('files', blob(PNG), 'a.png');
      f.append('alt', 'first');
      f.append('files', blob(PNG), 'b.png');
      f.append('files', blob(PNG), 'c.png');
      f.append('alt', 'third');
      const r = await batch(f);
      expect(r.status).toBe(201);
      const body = (await r.json()) as { items: Item[]; failed: Failure[] };
      expect(body.failed).toEqual([]);
      expect(body.items.map((m) => m.alt)).toEqual(['first', '', 'third']);
      expect(new Set(body.items.map((m) => m.id)).size).toBe(3);
      await cleanup(body.items);
    });

    it('stores the good files and reports the bad ones with their position', async () => {
      const f = new FormData();
      f.append('files', blob(PNG), 'ok.png');
      f.append('files', blob(Buffer.from('<script>alert(1)</script>')), 'evil.png');
      f.append('files', blob(Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)])), 'big.png');
      f.append('files', blob(PNG), 'ok2.png');
      const r = await batch(f);
      expect(r.status).toBe(201);
      const body = (await r.json()) as { items: Item[]; failed: Failure[] };
      expect(body.items).toHaveLength(2);
      expect(body.failed.map((x) => [x.index, x.filename, x.status])).toEqual([[1, 'evil.png', 415], [2, 'big.png', 413]]);
      await cleanup(body.items);
    });

    it('reports an over-long alt text against its own file only', async () => {
      const f = new FormData();
      f.append('files', blob(PNG), 'a.png');
      f.append('alt', 'x'.repeat(201));
      f.append('files', blob(PNG), 'b.png');
      const r = await batch(f);
      const body = (await r.json()) as { items: Item[]; failed: Failure[] };
      expect(body.items).toHaveLength(1);
      expect(body.failed).toMatchObject([{ index: 0, filename: 'a.png', status: 400 }]);
      await cleanup(body.items);
    });

    it('stores the first 20 and reports the rest when there are too many', async () => {
      const f = new FormData();
      for (let i = 0; i < 22; i++) f.append('files', blob(PNG), `n${i}.png`);
      const r = await batch(f);
      expect(r.status).toBe(201);
      const body = (await r.json()) as { items: Item[]; failed: Failure[] };
      expect(body.items).toHaveLength(20);
      expect(body.failed).toHaveLength(1);
      expect(body.failed[0].status).toBe(413);
      await cleanup(body.items);
    });

    it('refuses a request with no image with 415, and when every file is bad returns the first error', async () => {
      expect((await batch(new FormData())).status).toBe(415);
      const f = new FormData();
      f.append('files', blob(Buffer.from('nope')), 'x.png');
      expect((await batch(f)).status).toBe(415);
      const j = await fetch(`${base}/admin/media/batch`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
      expect(j.status).toBe(415);
    });

    it('requires authentication', async () => {
      const f = new FormData();
      f.append('files', blob(PNG), 'a.png');
      expect((await batch(f, {})).status).toBe(401);
    });

    it('leaves the single-file endpoint unchanged when extra files are sent', async () => {
      const f = new FormData();
      f.append('file', blob(PNG), 'a.png');
      f.append('file', blob(PNG), 'b.png');
      const r = await fetch(`${base}/admin/media`, { method: 'POST', headers: auth, body: f });
      expect([201, 413]).toContain(r.status);
      if (r.status === 201) await cleanup([(await r.json()) as Item]);
    });
  });

  describe('media batch delete', () => {
    type Item = { id: string };
    const send = (ids: unknown, headers: Record<string, string> = auth) => fetch(`${base}/admin/media/batch/delete`, { ...json({ ids }), headers: { ...headers, 'content-type': 'application/json' } });
    const make = async (n: number) => {
      const out: Item[] = [];
      for (let i = 0; i < n; i++) {
        const f = new FormData();
        f.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'd.png');
        out.push((await (await fetch(`${base}/admin/media`, { method: 'POST', headers: auth, body: f })).json()) as Item);
      }
      return out;
    };

    it('deletes several images at once and reports unknown ids per id', async () => {
      const made = await make(3);
      const ghost = '00000000-0000-4000-8000-000000000000';
      const r = await send([...made.map((m) => m.id), ghost]);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { deleted: string[]; failed: { id: string; status: number }[] };
      expect(body.deleted.sort()).toEqual(made.map((m) => m.id).sort());
      expect(body.failed).toMatchObject([{ id: ghost, status: 404 }]);
      const list = (await (await fetch(`${base}/admin/media?pageSize=100`, { headers: auth })).json()) as { items: Item[] };
      expect(list.items.some((m) => made.some((x) => x.id === m.id))).toBe(false);
    });

    it('rejects an empty, malformed or oversized id list with 400', async () => {
      expect((await send([])).status).toBe(400);
      expect((await send(['nope'])).status).toBe(400);
      expect((await send(undefined)).status).toBe(400);
      const id = '00000000-0000-4000-8000-000000000001';
      expect((await send([id, id])).status).toBe(400);
    });

    it('requires authentication', async () => {
      expect((await send(['00000000-0000-4000-8000-000000000001'], {})).status).toBe(401);
    });
  });

  describe('responses', () => {
    it('downloads the order export as an attachment', async () => {
      const r = await fetch(`${base}/admin/orders/export`, { headers: auth });
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/csv');
      expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="orders-\d{4}-\d{2}-\d{2}\.csv"$/);
    });

    it('answers an unknown route with problem+json that names the path', async () => {
      const r = await fetch(`${base}/nope?x=1`);
      expect(r.status).toBe(404);
      expect(r.headers.get('content-type')).toContain('application/problem+json');
      expect(((await r.json()) as { instance?: string }).instance).toBe('/api/v1/nope?x=1');
    });

    it('treats a trailing slash like no trailing slash', async () => {
      expect((await fetch(`${base}/admin/me/`, { headers: auth })).status).toBe(200);
    });
  });
});
