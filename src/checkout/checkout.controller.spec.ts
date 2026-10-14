import { StoreCheckoutController } from './checkout.controller';

const customer = { accountId: 'a1', customerId: 'c1', email: 'amina@example.com', name: 'Amina' };
const order = { id: 'o1', number: 'JB-000001', total: 1000 };
const res = () => ({ status: jest.fn() }) as never;

function make(created: boolean) {
  const orders = { checkout: jest.fn().mockResolvedValue({ order, created }) };
  const payments = { initiate: jest.fn().mockResolvedValue({ id: 'p1' }) };
  const mail = { sendOrderConfirmation: jest.fn() };
  const controller = new StoreCheckoutController(orders as never, payments as never, mail as never);
  return { controller, orders, payments, mail };
}

describe('StoreCheckoutController confirmation email', () => {
  it('emails the receipt to the account email for a newly created order', async () => {
    const { controller, mail, orders } = make(true);
    await controller.checkout({} as never, customer, 'idem-key-0001', res());
    expect(orders.checkout).toHaveBeenCalledWith({}, 'idem-key-0001', 'c1');
    expect(mail.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    // the greeting uses the account's own name, never the name stored on a linked guest record
    expect(mail.sendOrderConfirmation).toHaveBeenCalledWith('amina@example.com', { ...order, customer: { name: 'Amina' } });
  });

  it('does not email again when the same Idempotency-Key replays an existing order', async () => {
    const { controller, mail, payments } = make(false);
    const out = await controller.checkout({} as never, customer, 'idem-key-0001', res());
    expect(out).toMatchObject({ idempotentReplay: true });
    expect(mail.sendOrderConfirmation).not.toHaveBeenCalled();
    expect(payments.initiate).not.toHaveBeenCalled();
  });

  it('still answers when payment initiation fails, and the email is still sent', async () => {
    const { controller, mail, payments } = make(true);
    payments.initiate.mockRejectedValue(new Error('daraja down'));
    const out = await controller.checkout({} as never, customer, 'idem-key-0001', res());
    expect(out).toMatchObject({ payment: null, idempotentReplay: false });
    expect(mail.sendOrderConfirmation).toHaveBeenCalledTimes(1);
  });
});
