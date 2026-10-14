const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escapes any value. Every value that reaches an email template goes through this. */
export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c]);

export const kes = (n: number): string => `KES ${new Intl.NumberFormat('en-KE').format(n)}`;

export const nairobiTime = (d: Date): string =>
  new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(d);

export const firstName = (full: string): string => full.trim().split(/\s+/)[0] || 'there';

export const trimSlash = (url: string): string => url.replace(/\/+$/, '');
