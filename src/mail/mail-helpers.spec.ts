import type { AppConfig } from '../config/config';
import { MailService, MailTransport } from './mail.service';
import type { ReceiptOrder } from './templates/order-confirmation';

const cfg = { nodeEnv: 'test', mail: { from: 'Jabali <no-reply@jabali.co.ke>', storeUrl: 'https://shop.example.com' } } as unknown as AppConfig;

function make() {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
  const service = new MailService({ sendMail } as MailTransport, cfg);
  service.retryDelaysMs = [0];
  return { service, sendMail };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('MailService helpers', () => {
  it('sendVerificationCode queues the code email without the code in the subject', async () => {
    const { service, sendMail } = make();
    service.sendVerificationCode('amina@example.com', 'Amina Said', '042917', 10);
    await flush();
    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ to: 'amina@example.com', subject: 'Your Jabali verification code' });
    expect(mail.subject).not.toContain('042917');
    expect(mail.text).toContain('042917');
    expect(mail.html).toContain('042917');
  });

  it('sendWelcome queues the welcome email to the customer', async () => {
    const { service, sendMail } = make();
    service.sendWelcome('amina@example.com', 'Amina Said');
    await flush();
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'amina@example.com', subject: 'Welcome to Jabali' });
    expect(sendMail.mock.calls[0][0].html).toContain('https://shop.example.com/shop');
  });

  it('sendOrderConfirmation queues the receipt with the order number in the subject', async () => {
    const { service, sendMail } = make();
    const order: ReceiptOrder = {
      number: 'JB-000007',
      createdAt: new Date(),
      method: 'pickup',
      paymentMethod: 'cod',
      subtotal: 1000,
      discount: 0,
      deliveryFee: 0,
      total: 1000,
      county: null,
      address: 'Studio',
      eta: null,
      customer: { name: 'Amina' },
      lines: [{ name: 'Tee', colour: 'White', size: 'M', qty: 1, unitPrice: 1000, discount: 0, lineTotal: 1000, gift: null }],
    };
    service.sendOrderConfirmation('amina@example.com', order);
    await flush();
    expect(sendMail.mock.calls[0][0].subject).toContain('JB-000007');
    expect(sendMail.mock.calls[0][0].text).toContain('KES 1,000');
  });
});
