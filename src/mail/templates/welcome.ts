import { esc, firstName, trimSlash } from './escape';
import { button, layout } from './layout';

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

/** The four promises the storefront makes (same wording as the home page trust strip). */
const PROMISES: [string, string][] = [
  ['Pay with M-Pesa', 'STK push to your phone. No card needed.'],
  ['Delivery nationwide', 'Same-day in Nairobi, up to 5 days upcountry.'],
  ['Pay on delivery', 'Available in Nairobi. Try before you pay.'],
  ['Gifts done properly', 'Pick the piece, choose the box, write the card.'],
];

const card = ([title, body]: [string, string]) =>
  `<td width="50%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;border-left:4px solid #c6e24f;"><tr><td style="padding:14px 16px;"><div style="font-weight:700;font-size:15px;color:#111311;">${esc(title)}</div><div style="margin-top:4px;font-size:13px;line-height:1.5;color:#4a4e4a;">${esc(body)}</div></td></tr></table></td>`;

/** Sent once, when the customer has confirmed their email and the account becomes active. */
export function welcomeEmail(input: { name: string; storeUrl: string }): MailContent {
  const store = trimSlash(input.storeUrl);
  const name = firstName(input.name);
  const shop = `${store}/shop`;
  const gift = `${store}/gift`;

  const grid = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px -6px 26px;"><tr>${card(PROMISES[0])}${card(PROMISES[1])}</tr><tr>${card(PROMISES[2])}${card(PROMISES[3])}</tr></table>`;

  const html = layout({
    preheader: 'Your email is verified and your Jabali account is ready.',
    storeUrl: store,
    hero: {
      eyebrow: 'Account verified',
      title: `Welcome to Jabali, ${name}.`,
      subtitle: 'Sharp suits, easy basics and gifts worth opening, delivered anywhere in Kenya.',
    },
    bodyHtml: `<p style="margin:0 0 22px;line-height:1.6;color:#4a4e4a;font-size:15px;">Your email is verified and your account is ready. Sign in with this email address whenever you shop, and your details will be filled in at checkout.</p>
${grid}
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:16px;">${button(shop, 'Start shopping')}</td><td><a href="${esc(gift)}" style="color:#111311;font-weight:700;font-size:14px;">Build a gift</a></td></tr></table>`,
  });

  const text = [
    `Welcome to Jabali, ${name}.`,
    '',
    'Your email is verified and your account is ready. Sign in with this email address whenever you shop, and your details will be filled in at checkout.',
    '',
    ...PROMISES.map(([title, body]) => `- ${title}: ${body}`),
    '',
    `Start shopping: ${shop}`,
    `Build a gift: ${gift}`,
    '',
    'Prices in Kenya Shillings and include VAT.',
  ].join('\n');

  return { subject: 'Welcome to Jabali', html, text };
}
