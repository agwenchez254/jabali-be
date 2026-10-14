import { esc, firstName, kes, trimSlash } from './escape';
import { orderConfirmationEmail, ReceiptOrder } from './order-confirmation';
import { welcomeEmail } from './welcome';

const store = 'https://shop.example.com/';

const order = (over: Partial<ReceiptOrder> = {}): ReceiptOrder => ({
  number: 'JB-000123',
  createdAt: new Date('2026-10-14T17:30:00Z'),
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
  ...over,
});

describe('escape helpers', () => {
  it('escapes HTML metacharacters', () => {
    expect(esc(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
    expect(esc(null)).toBe('');
  });
  it('formats shillings, first names and URLs', () => {
    expect(kes(3200)).toBe('KES 3,200');
    expect(kes(0)).toBe('KES 0');
    expect(firstName('  Amina  Said ')).toBe('Amina');
    expect(firstName('   ')).toBe('there');
    expect(trimSlash('https://a.co///')).toBe('https://a.co');
  });
});

describe('welcomeEmail', () => {
  const mail = welcomeEmail({ name: 'Amina Said', storeUrl: store });
  it('greets by first name and links to the shop', () => {
    expect(mail.subject).toMatch(/Welcome to Jabali/);
    expect(mail.html).toContain('Amina');
    expect(mail.html).toContain('href="https://shop.example.com/shop"');
    expect(mail.text).toContain('https://shop.example.com/shop');
  });
  it('has the three onboarding steps in both parts and never mentions a password or token', () => {
    for (const part of [mail.html, mail.text]) {
      expect(part).toMatch(/M-Pesa/);
      expect(part).toMatch(/Same-day delivery in Nairobi/);
      expect(part).not.toMatch(/password|token/i);
    }
  });
  it('escapes a hostile name', () => {
    const evil = welcomeEmail({ name: '<script>alert(1)</script> Amina', storeUrl: store });
    expect(evil.html).not.toContain('<script');
    expect(evil.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('orderConfirmationEmail', () => {
  const mail = orderConfirmationEmail({ order: order(), storeUrl: store });

  it('puts the order number in the subject and the receipt in the body', () => {
    expect(mail.subject).toBe('Order JB-000123 received: your Jabali receipt');
    expect(mail.html).toContain('JB-000123');
    expect(mail.html).toMatch(/2026/);
  });

  it('lists every line with colour, size, quantity and amounts', () => {
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain('Oxford Button-Down');
      expect(part).toContain('Sky');
      expect(part).toContain('KES 3,200');
      expect(part).toContain('KES 6,000');
      expect(part).toContain('Woven Silk Tie');
      expect(part).toContain('KES 400');
    }
  });

  it('shows subtotal, discount, delivery and the total', () => {
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain('KES 6,400');
      expect(part).toContain('KES 6,250');
      expect(part).toContain('KES 250');
    }
    expect(mail.text).toMatch(/Discount.*-KES 400/);
  });

  it('shows Free for a zero delivery fee and hides a zero discount', () => {
    const free = orderConfirmationEmail({ order: order({ deliveryFee: 0, discount: 0, total: 6400 }), storeUrl: store });
    expect(free.text).toMatch(/Delivery\s+Free/);
    expect(free.text).not.toMatch(/Discount/);
  });

  it('explains what happens next for each payment method', () => {
    expect(mail.text).toMatch(/M-Pesa prompt/);
    expect(mail.text).toMatch(/30 minutes/);
    expect(orderConfirmationEmail({ order: order({ paymentMethod: 'cod' }), storeUrl: store }).text).toMatch(/Pay KES 6,250 to the rider/);
    expect(orderConfirmationEmail({ order: order({ paymentMethod: 'airtel' }), storeUrl: store }).text).toMatch(/Airtel/);
    expect(orderConfirmationEmail({ order: order({ paymentMethod: 'card' }), storeUrl: store }).text).toMatch(/card payment/i);
  });

  it('shows the delivery address and estimate, or the pickup address', () => {
    expect(mail.text).toContain('Kilimani, Argwings Kodhek Rd, Apt 4');
    expect(mail.text).toContain('Same-day if ordered before 2 pm');
    const pickup = orderConfirmationEmail({ order: order({ method: 'pickup', county: null, address: 'Jabali Studio, Nairobi CBD', eta: null, deliveryFee: 0 }), storeUrl: store });
    expect(pickup.text).toMatch(/Pickup at/);
    expect(pickup.text).toContain('Jabali Studio, Nairobi CBD');
    expect(pickup.text).not.toMatch(/Delivery to/);
  });

  it('marks gift-wrapped lines', () => {
    expect(mail.html).toMatch(/Gift wrapped/);
    expect(mail.text).toMatch(/Gift wrapped/);
  });

  it('escapes hostile names, addresses and product names, and keeps the subject on one line', () => {
    const evil = orderConfirmationEmail({
      order: order({
        number: 'JB-1\r\nBcc: evil@example.com',
        customer: { name: '<script>x</script>' },
        address: '"><img src=x onerror=alert(1)>',
        lines: [{ name: '<b>Suit</b>', colour: '"><i>', size: "'", qty: 1, unitPrice: 100, discount: 0, lineTotal: 100, gift: null }],
      }),
      storeUrl: store,
    });
    expect(evil.html).not.toMatch(/<script|<img |<b>Suit|<i>/);
    expect(evil.html).toContain('&lt;b&gt;Suit&lt;/b&gt;');
    expect(evil.subject).not.toMatch(/[\r\n]/);
  });

  it('links only to the configured store', () => {
    const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h.startsWith('https://shop.example.com')).toBe(true);
  });

  it('copes with a missing order number', () => {
    expect(orderConfirmationEmail({ order: order({ number: null }), storeUrl: store }).subject).toBe('Order received: your Jabali receipt');
  });
});
