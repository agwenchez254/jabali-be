import { esc, firstName, trimSlash } from './escape';
import { layout } from './layout';
import type { MailContent } from './welcome';

/** The email that carries the account-activation code. The code is never put in a link or in the subject. */
export function verificationCodeEmail(input: { name: string; code: string; minutes: number; storeUrl: string }): MailContent {
  const store = trimSlash(input.storeUrl);
  const name = firstName(input.name);

  const html = layout({
    preheader: 'Your Jabali verification code. It expires soon.',
    storeUrl: store,
    hero: { eyebrow: 'One last step', title: `Confirm your email, ${name}.` },
    bodyHtml: `<p style="margin:0 0 18px;line-height:1.6;color:#4a4e4a;font-size:15px;">Enter this code on the Jabali sign-up screen to activate your account.</p>
<div style="margin:0 0 18px;padding:20px 24px;background:#f4f4f1;border-left:4px solid #c6e24f;text-align:center;">
<div style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;letter-spacing:10px;color:#111311;">${esc(input.code)}</div>
</div>
<p style="margin:0 0 18px;line-height:1.6;color:#111311;font-size:15px;"><strong>This code expires in ${esc(input.minutes)} minutes.</strong></p>
<p style="margin:0 0 10px;line-height:1.6;color:#4a4e4a;font-size:13px;">If you did not create a Jabali account, you can ignore this email. Nobody can use your address without this code.</p>
<p style="margin:0;line-height:1.6;color:#4a4e4a;font-size:13px;">Jabali will never ask you for this code by phone, WhatsApp or message.</p>`,
  });

  const text = [
    `Confirm your email, ${name}.`,
    '',
    'Enter this code on the Jabali sign-up screen to activate your account:',
    '',
    `    ${input.code}`,
    '',
    `This code expires in ${input.minutes} minutes.`,
    '',
    'If you did not create a Jabali account, you can ignore this email. Nobody can use your address without this code.',
    'Jabali will never ask you for this code by phone, WhatsApp or message.',
  ].join('\n');

  return { subject: 'Your Jabali verification code', html, text };
}
