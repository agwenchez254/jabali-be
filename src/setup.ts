import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet, { type HelmetOptions } from 'helmet';
import { resolve } from 'node:path';
import { AppConfig } from './config/config';
import { FieldError } from './common/models';
import { ProblemDetailsFilter } from './common/problem-details.filter';

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/** Helmet settings. The API only serves JSON, so production gets a CSP that allows nothing. */
export function helmetOptions(cfg: Pick<AppConfig, 'nodeEnv'>): HelmetOptions {
  return {
    // Development keeps no CSP so Swagger UI can load its assets.
    contentSecurityPolicy: cfg.nodeEnv === 'production' ? { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } : false,
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
    // images from /uploads are embedded by the storefront and dashboard on other origins
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  };
}

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export function configureApp(app: NestExpressApplication, cfg: AppConfig, opts: { swagger?: boolean } = {}): void {
  app.set('trust proxy', cfg.trustProxyHops);
  app.use(helmet(helmetOptions(cfg)));
  app.use(cookieParser());
  app.enableCors({
    origin: cfg.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['ETag', 'Retry-After'],
  });
  app.useBodyParser('json', { limit: '100kb' });
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
  app.useStaticAssets(resolve(cfg.uploadDir), {
    prefix: '/uploads',
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
