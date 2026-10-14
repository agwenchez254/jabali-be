import { Prisma } from '@prisma/client';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

/** Normalises Kenyan phone numbers to +2547XXXXXXXX / +2541XXXXXXXX, or null when invalid. */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, '');
  const m = d.match(/^(?:\+?254|0)?([17]\d{8})$/);
  return m ? `+254${m[1]}` : null;
}

export function formatOrderNumber(seq: number): string {
  return `JB-${String(seq).padStart(6, '0')}`;
}

/** Looks up a unique slug by appending -2, -3 ... until `exists` says it is free. */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || 'item';
  let candidate = root;
  for (let i = 2; await exists(candidate); i++) candidate = `${root}-${i}`;
  return candidate;
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
