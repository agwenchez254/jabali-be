import { esc, firstName, trimSlash } from './escape';
import { button, layout } from './layout';

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

const STEPS: [string, string][] = [
  ['Find something you like', 'Browse suits, shirts, dresses and more. Every piece shows the sizes that are in stock.'],
  ['Pay your way', 'M-Pesa and Airtel Money prompts go straight to your phone. In Nairobi you can also pay on delivery.'],
  ['We bring it to you', 'Same-day delivery in Nairobi for orders before 2 pm, and 2 to 5 days to other counties.'],
];

export function welcomeEmail(input: { name: string; storeUrl: string }): MailContent {
  const store = trimSlash(input.storeUrl);
  const name = firstName(input.name);
  const shop = `${store}/shop`;

  const stepsHtml = STEPS.map(
    ([title, body], i) =>
      `<tr><td style="padding:10px 0;vertical-align:top;width:32px;font-weight:700;color:#111311;">${i + 1}</td><td style="padding:10px 0;"><strong>${esc(title)}</strong><br><span style="color:#4a4e4a;">${esc(body)}</span></td></tr>`,
  ).join('');

  const html = layout({
    preheader: 'Your Jabali account is ready.',
    storeUrl: store,
    bodyHtml: `<h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;">Welcome to Jabali, ${esc(name)}.</h1>
<p style="margin:0 0 20px;line-height:1.6;color:#4a4e4a;">Your account is ready. Sign in with this email address whenever you shop, and your details will be filled in at checkout.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${stepsHtml}</table>
${button(shop, 'Start shopping')}`,
  });

  const text = [
    `Welcome to Jabali, ${name}.`,
    '',
    'Your account is ready. Sign in with this email address whenever you shop, and your details will be filled in at checkout.',
    '',
    ...STEPS.map(([title, body], i) => `${i + 1}. ${title}\n   ${body}`),
    '',
    `Start shopping: ${shop}`,
    '',
    'Prices in Kenya Shillings and include VAT.',
  ].join('\n');

  return { subject: 'Welcome to Jabali', html, text };
}
