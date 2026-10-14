import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config/config';
import { configureApp } from '../src/setup';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './global-setup';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://jabali:jabali_dev_pw@localhost:5439/jabali_test?schema=public';

jest.setTimeout(30_000);

const openStreams: { close: () => void }[] = [];

/** Minimal SSE reader over fetch. Every stream is closed in afterEach so a failed test cannot hang app.close(). */
async function openStream(url: string) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const stream = {
    async next(type: string, timeoutMs = 5000): Promise<{ tags: string[] }> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (event === type && data) return JSON.parse(data) as { tags: string[] };
        }
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`no "${type}" event within ${timeoutMs}ms`);
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no "${type}" event within ${timeoutMs}ms`)), left)),
        ]);
        if (chunk.done) throw new Error('stream ended');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    close: () => ctrl.abort(),
  };
  openStreams.push(stream);
  return stream;
}

describe('GET /store/events', () => {
  let app: NestExpressApplication;
  let base: string;
  let auth: Record<string, string>;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_URL;
    process.env.ENABLE_SCHEDULER = 'false';
    const { AppModule } = await import('../src/app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app, loadConfig());
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
    const login = await fetch(`${base}/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
    });
    const { accessToken } = (await login.json()) as { accessToken: string };
    auth = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  });

  afterEach(() => {
    for (const s of openStreams.splice(0)) s.close();
  });

  afterAll(async () => {
    await app.close();
  });

  it('emits Testimonial and Home tags after an admin testimonial write', async () => {
    const stream = await openStream(`${base}/store/events`);
    await fetch(`${base}/admin/testimonials`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'E2E', quote: 'Live update' }) });
    const event = await stream.next('invalidate');
    expect(event.tags).toEqual(expect.arrayContaining(['Testimonial', 'Home']));
    stream.close();
  });

  it('clears the store cache before emitting, so a refetch sees the published block', async () => {
    const key = `e2e.live.${Date.now()}`;
    const created = await fetch(`${base}/admin/content/blocks`, { method: 'POST', headers: auth, body: JSON.stringify({ key, kind: 'banner', data: { v: 1 } }) });
    const { id } = (await created.json()) as { id: string };
    await fetch(`${base}/admin/content/blocks/${id}/publish`, { method: 'POST', headers: auth, body: '{}' });

    // Prime the 60s cache with v1.
    const before = (await (await fetch(`${base}/store/home`)).json()) as { blocks: { key: string; data: { v: number } }[] };
    expect(before.blocks.find((b) => b.key === key)?.data.v).toBe(1);

    // Edit the draft first (this emits, but nothing is live yet), then open the stream and publish.
    await fetch(`${base}/admin/content/blocks/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ data: { v: 2 } }) });
    const stream = await openStream(`${base}/store/events`);
    await fetch(`${base}/admin/content/blocks/${id}/publish`, { method: 'POST', headers: auth, body: '{}' });
    const event = await stream.next('invalidate');
    expect(event.tags).toEqual(expect.arrayContaining(['Home', 'Content']));

    const after = (await (await fetch(`${base}/store/home`)).json()) as { blocks: { key: string; data: { v: number } }[] };
    expect(after.blocks.find((b) => b.key === key)?.data.v).toBe(2);
    stream.close();
  });
});
