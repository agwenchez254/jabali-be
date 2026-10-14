import * as nodemailer from 'nodemailer';
import { loadConfig } from '../src/config/config';
import { MailService, MailTransport } from '../src/mail/mail.service';
import type { ReceiptOrder } from '../src/mail/templates/order-confirmation';
import { orderConfirmationEmail } from '../src/mail/templates/order-confirmation';
import { verificationCodeEmail } from '../src/mail/templates/verification';
import { welcomeEmail } from '../src/mail/templates/welcome';

try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

/** Sends the verification code, welcome and order confirmation emails through the configured SMTP server (default: local Mailpit). */
async function main(): Promise<void> {
  const cfg = loadConfig({ ...process.env, SMTP_URL: process.env.SMTP_URL || 'smtp://localhost:1025' });
  const mail = new MailService(nodemailer.createTransport({ url: cfg.mail.smtpUrl! }) as unknown as MailTransport, cfg);
  mail.retryDelaysMs = [0];
  const to = process.argv[2] ?? 'amina@example.com';
  const order: ReceiptOrder = {
    number: 'JB-000123',
    createdAt: new Date(),
    method: 'delivery',
    paymentMethod: 'mpesa',
    subtotal: 6400,
    discount: 400,
    deliveryFee: 250,
    total: 6250,
    county: 'Nairobi',
    address: 'Kilimani, Argwings Kodhek Rd, Apt 4',
    eta: 'Same-day if ordered before 2 pm',
    customer: { name: 'Amina Said' },
    lines: [
      { name: 'Oxford Button-Down', colour: 'Sky', size: 'M', qty: 2, unitPrice: 3200, discount: 400, lineTotal: 6000, gift: null },
      { name: 'Woven Silk Tie', colour: 'Navy', size: 'One size', qty: 1, unitPrice: 400, discount: 0, lineTotal: 400, gift: { wrap: 'forest' } },
    ],
  };
  const results = [
    await mail.send({ to, ...verificationCodeEmail({ name: 'Amina Said', code: '042917', minutes: 10, storeUrl: cfg.mail.storeUrl }) }),
    await mail.send({ to, ...welcomeEmail({ name: 'Amina Said', storeUrl: cfg.mail.storeUrl }) }),
    await mail.send({ to, ...orderConfirmationEmail({ order, storeUrl: cfg.mail.storeUrl }) }),
  ];
  const label = ['verification code', 'welcome', 'order confirmation'];
  console.log(results.map((ok, i) => `${label[i]}: ${ok ? 'sent' : 'FAILED'}`).join(', '), `(to ${to} via ${cfg.mail.smtpUrl?.replace(/\/\/.*@/, '//***@')})`);
  process.exit(results.every(Boolean) ? 0 : 1);
}

void main();
