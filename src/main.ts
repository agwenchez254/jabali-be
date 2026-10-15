import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import compress from '@fastify/compress';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import { configureApp, createAdapter } from './setup';

async function bootstrap(): Promise<void> {
  try {
    process.loadEnvFile(); // .env in cwd (Node >= 20.12); real env vars still win
  } catch {
    /* no .env file: rely on the process environment */
  }
  const cfg = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter(cfg), { rawBody: true });
  await app.register(compress);
  await configureApp(app, cfg, { swagger: true });
  app.enableShutdownHooks();
  await app.listen(cfg.port, process.env.HOST ?? '0.0.0.0');
  new Logger('Bootstrap').log(`API on http://localhost:${cfg.port}/api/v1  docs: /api/docs`);
}

void bootstrap();
