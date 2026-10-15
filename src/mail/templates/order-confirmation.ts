import { esc, kes, nairobiTime, trimSlash } from './escape';
import { button, layout } from './layout';
import type { MailContent } from './welcome';

/** VAT fixed on the order at checkout. Null/absent while VAT was off when the order was placed. */
export interface ReceiptVat {
  ratePercent: number;
  amount: number;
  net: number;
  seller: { businessName: string; kraPin: string; address: string };
}

export interface ReceiptLine {
  name: string;
  colour: string;
  size: string;
  qty: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  /** Gift options when the line is a gift, otherwise null. */
  gift: unknown;
}

/** The slice of an order the receipt needs. `OrdersService.view()` satisfies it. */
export interface ReceiptOrder {
  number: string | null;
  createdAt: Date;
  method: string;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  county: string | null;
  address: string | null;
  eta: string | null;
  customer: { name: string };
  lines: ReceiptLine[];
  vat?: ReceiptVat | null;
}

const PAYMENT_LABEL: Record<string, string> = { mpesa: 'M-Pesa', airtel: 'Airtel Money', card: 'Card', cod: 'Pay on delivery' };

function paymentNote(method: string, total: number): string {
  switch (method) {
    case 'mpesa':
      return `Approve the M-Pesa prompt on your phone to pay ${kes(total)}. We hold your items for 30 minutes.`;
    case 'airtel':
      return `Approve the Airtel Money prompt on your phone to pay ${kes(total)}. We hold your items for 30 minutes.`;
    case 'card':
      return `Complete your card payment of ${kes(total)} to confirm the order. We hold your items for 30 minutes.`;
    case 'cod':
      return `Pay ${kes(total)} to the rider when your order arrives (cash or M-Pesa).`;
    default:
      return '';
  }
}

export function orderConfirmationEmail(input: { order: ReceiptOrder; storeUrl: string }): MailContent {
  const { order } = input;
  const store = trimSlash(input.storeUrl);
  const number = order.number ?? '';
  const subject = number ? `Order ${number} received: your Jabali receipt` : 'Order received: your Jabali receipt';
  const placed = nairobiTime(order.createdAt);
  const pay = PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod;
  const note = paymentNote(order.paymentMethod, order.total);
  const where = order.method === 'pickup' ? 'Pickup at' : 'Delivery to';
  const address = [order.address, order.method === 'delivery' ? order.county : null].filter(Boolean).join(', ');
  const delivery = order.deliveryFee === 0 ? 'Free' : kes(order.deliveryFee);
  const vat = order.vat ?? null;
  const rate = vat ? `${Number.isInteger(vat.ratePercent) ? vat.ratePercent : vat.ratePercent.toFixed(2)}%` : '';
  const first = order.customer.name.trim().split(/\s+/)[0] || 'there';

  const cell = 'padding:10px 0;border-bottom:1px solid #e5e5e0;vertical-align:top;';
  const rows = order.lines
    .map(
      (l) => `<tr>
<td style="${cell}"><strong>${esc(l.name)}</strong><br><span style="color:#6b6f6b;font-size:13px;">${esc(l.colour)} &middot; ${esc(l.size)}${l.gift ? ' &middot; Gift wrapped' : ''}</span></td>
<td style="${cell}text-align:center;">${esc(l.qty)}</td>
<td style="${cell}text-align:right;">${esc(kes(l.unitPrice))}</td>
<td style="${cell}text-align:right;">${esc(kes(l.lineTotal))}</td></tr>`,
    )
    .join('');

  const totalRow = (label: string, value: string, bold = false) =>
    `<tr><td colspan="3" style="padding:6px 0;text-align:right;color:#4a4e4a;${bold ? 'font-weight:700;color:#111311;font-size:16px;' : ''}">${esc(label)}</td><td style="padding:6px 0;text-align:right;${bold ? 'font-weight:700;font-size:16px;' : ''}">${esc(value)}</td></tr>`;

  const html = layout({
    preheader: `Order ${number} received. Total ${kes(order.total)}.`,
    storeUrl: store,
    bodyHtml: `<h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;">Thanks, ${esc(first)}. We have your order.</h1>
<p style="margin:0 0 20px;color:#4a4e4a;">${number ? `Order <strong>${esc(number)}</strong> &middot; ` : ''}${esc(placed)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 8px;">
<tr><th align="left" style="padding:8px 0;border-bottom:2px solid #111311;">Item</th><th style="padding:8px 0;border-bottom:2px solid #111311;">Qty</th><th align="right" style="padding:8px 0;border-bottom:2px solid #111311;">Price</th><th align="right" style="padding:8px 0;border-bottom:2px solid #111311;">Total</th></tr>
${rows}
${totalRow('Subtotal', kes(order.subtotal))}${order.discount > 0 ? totalRow('Discount', `-${kes(order.discount)}`) : ''}${totalRow('Delivery', delivery)}${totalRow('Total', kes(order.total), true)}${vat ? totalRow(`Amount before VAT`, kes(vat.net)) + totalRow(`VAT (${rate}) included`, kes(vat.amount)) : ''}
</table>
<h2 style="margin:24px 0 6px;font-size:16px;">Payment</h2>
<p style="margin:0;line-height:1.6;color:#4a4e4a;"><strong style="color:#111311;">${esc(pay)}.</strong> ${esc(note)}</p>
<h2 style="margin:24px 0 6px;font-size:16px;">${esc(where)}</h2>
<p style="margin:0 0 24px;line-height:1.6;color:#4a4e4a;">${esc(address)}${order.eta ? `<br>${esc(order.eta)}` : ''}</p>
${vat ? `<h2 style="margin:0 0 6px;font-size:16px;">Sold by</h2>
<p style="margin:0 0 24px;line-height:1.6;color:#4a4e4a;"><strong style="color:#111311;">${esc(vat.seller.businessName)}</strong><br>KRA PIN ${esc(vat.seller.kraPin)}${vat.seller.address ? `<br>${esc(vat.seller.address)}` : ''}</p>` : ''}
${button(`${store}/shop`, 'Continue shopping')}`,
  });

  const line = (label: string, value: string) => `${label.padEnd(10)}${value}`;
  const text = [
    `Thanks, ${first}. We have your order.`,
    number ? `Order ${number} - ${placed}` : placed,
    '',
    ...order.lines.flatMap((l) => [
      `${l.name} (${l.colour}, ${l.size})${l.gift ? ' - Gift wrapped' : ''}`,
      `  ${l.qty} x ${kes(l.unitPrice)} = ${kes(l.lineTotal)}`,
    ]),
    '',
    line('Subtotal', kes(order.subtotal)),
    ...(order.discount > 0 ? [line('Discount', `-${kes(order.discount)}`)] : []),
    line('Delivery', delivery),
    line('Total', kes(order.total)),
    ...(vat ? [line('Before VAT', kes(vat.net)), line(`VAT ${rate}`, `${kes(vat.amount)} (included)`)] : []),
    '',
    `Payment: ${pay}`,
    note,
    '',
    `${where}: ${address}`,
    ...(order.eta ? [order.eta] : []),
    '',
    ...(vat ? ['', `Sold by ${vat.seller.businessName}, KRA PIN ${vat.seller.kraPin}${vat.seller.address ? `, ${vat.seller.address}` : ''}`] : []),
    '',
    `Continue shopping: ${store}/shop`,
    '',
    'Prices in Kenya Shillings and include VAT.',
  ].join('\n');

  return { subject: subject.replace(/[\r\n]+/g, ' '), html, text };
}
