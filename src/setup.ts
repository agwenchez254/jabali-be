import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet, { type FastifyHelmetOptions } from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { resolve } from 'node:path';
import { AppConfig } from './config/config';
import { FieldError } from './common/models';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { NonceStore, SIGNING_ALG, loadSigningConfig, requiresSignature, verifyRequest } from './common/request-signing/request-signing';
import { SecurityLogService } from './common/security-log/security-log.service';

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/** Helmet settings. The API only serves JSON, so production gets a CSP that allows nothing. */
export function helmetOptions(cfg: Pick<AppConfig, 'nodeEnv'>): FastifyHelmetOptions {
  return {
    // Development keeps no CSP so Swagger UI can load its assets.
    contentSecurityPolicy: cfg.nodeEnv === 'production' ? { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } : false,
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
    // images from /uploads are embedded by the storefront and dashboard on other origins
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  };
}

/** Server options that can only be set when the adapter is created. Shared by main.ts and the e2e tests. */
export function createAdapter(cfg: Pick<AppConfig, 'trustProxyHops'>): FastifyAdapter {
  return new FastifyAdapter({
    // Number of reverse proxies in front of the API, so request.ip is the real client address.
    trustProxy: cfg.trustProxyHops,
    bodyLimit: 100 * 1024,
    routerOptions: { ignoreTrailingSlash: true },
  });
}

/**
 * Rejects requests that our own frontends did not sign (see common/request-signing). Runs after the body is parsed so
 * the digest covers the exact bytes received, and before any controller or guard.
 */
function registerRequestSigning(app: NestFastifyApplication, fastify: ReturnType<ReturnType<NestFastifyApplication['getHttpAdapter']>['getInstance']>): void {
  const signing = loadSigningConfig(process.env);
  if (!signing.enabled) return;
  const nonces = new NonceStore();
  const security = app.get(SecurityLogService, { strict: false });
  const header = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

  fastify.addHook('preValidation', async (req, reply) => {
    const url = req.raw.url ?? req.url;
    if (!requiresSignature(req.method, url)) return;
    const h = req.headers;
    const verdict = verifyRequest(
      {
        method: req.method,
        url,
        headers: {
          clientId: header(h['x-client-id']),
          timestamp: header(h['x-timestamp']),
          nonce: header(h['x-nonce']),
          contentSha256: header(h['x-content-sha256']),
          signature: header(h['x-signature']),
          alg: header(h['x-signature-alg']),
        },
        body: (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0),
        isMultipart: (header(h['content-type']) ?? '').startsWith('multipart/'),
      },
      signing.keys,
      nonces,
    );
    if (verdict.ok) return;
    security.log('signature_rejected', { ip: req.ip, method: req.method, path: url.split('?')[0], reason: verdict.reason, expectedAlg: SIGNING_ALG });
    // One generic answer for every failure, so a probing caller learns nothing about which check failed.
    return reply
      .code(401)
      .header('content-type', 'application/problem+json')
      .send({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Invalid request signature', instance: url, code: 'invalid_signature' });
  });
}

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export async function configureApp(app: NestFastifyApplication, cfg: AppConfig, opts: { swagger?: boolean } = {}): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  // Express accepted `Content-Type: application/json` with an empty body; Fastify answers 400. Keep the old behaviour.
  fastify.addHook('onRequest', (req, _reply, done) => {
    if (req.headers['content-length'] === '0' && req.headers['content-type']?.startsWith('application/json')) delete req.headers['content-type'];
    done();
  });
  registerRequestSigning(app, fastify);
  await app.register(fastifyHelmet, helmetOptions(cfg));
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 5 } });
  // Routes that take more (POST /admin/media/batch) raise files and fields per request.
  app.enableCors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Client-Id', 'X-Timestamp', 'X-Nonce', 'X-Content-Sha256', 'X-Signature', 'X-Signature-Alg'],
    exposedHeaders: ['ETag', 'Retry-After'],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errs) =>
        new BadRequestException({ message: 'Validation failed', code: 'validation_failed', errors: flatten(errs) }),
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useStaticAssets({
    root: resolve(cfg.uploadDir),
    prefix: '/uploads/',
    maxAge: '7d',
    // Uploaded files must never be able to run script in the API origin.
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', 'sandbox');
    },
  });

  if (opts.swagger && cfg.nodeEnv !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Jabali API')
        .setDescription('Storefront (/store/*) and admin (/admin/*) API. Errors are RFC 7807 application/problem+json.')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });
  }
}
