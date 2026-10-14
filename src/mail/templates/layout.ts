import { esc } from './escape';

/** Table-based layout with inline styles (email clients ignore most CSS). Jabali colours: ink #111311, accent #c6e24f. */
export function layout(opts: { preheader: string; bodyHtml: string; storeUrl: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Jabali</title></head>
<body style="margin:0;background:#f4f4f1;font-family:Helvetica,Arial,sans-serif;color:#111311;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">
<tr><td style="background:#111311;padding:20px 28px;"><a href="${esc(opts.storeUrl)}" style="color:#c6e24f;font-size:22px;font-weight:700;letter-spacing:2px;text-decoration:none;">JABALI</a></td></tr>
<tr><td style="padding:28px;">${opts.bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #e5e5e0;color:#6b6f6b;font-size:12px;line-height:1.5;">Prices in Kenya Shillings and include VAT.<br>Jabali &middot; <a href="${esc(opts.storeUrl)}" style="color:#6b6f6b;">${esc(opts.storeUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
</table></td></tr></table></body></html>`;
}

export const button = (href: string, label: string): string =>
  `<a href="${esc(href)}" style="display:inline-block;background:#c6e24f;color:#111311;font-weight:700;text-decoration:none;padding:14px 28px;">${esc(label)}</a>`;
