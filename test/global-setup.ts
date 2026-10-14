import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedAccess } from '../prisma/seed-lib';

export const TEST_ADMIN_EMAIL = 'e2e-owner@jabali.test';
export const TEST_ADMIN_PASSWORD = 'E2e-Password-123!';

/** Creates the test database if needed, migrates it, wipes it and seeds roles + one owner. */
export default async function globalSetup(): Promise<void> {
  const envFile = resolve(__dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const testUrl =
    process.env.TEST_DATABASE_URL ?? 'postgresql://jabali:jabali_dev_pw@localhost:5439/jabali_test?schema=public';

  const u = new URL(testUrl);
  const dbName = u.pathname.slice(1);
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const rows = await admin.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_database WHERE datname = ${dbName}`;
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length) {
      const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
    await seedAccess(prisma, { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD, name: 'E2E Owner' });
  } finally {
    await prisma.$disconnect();
  }
}
