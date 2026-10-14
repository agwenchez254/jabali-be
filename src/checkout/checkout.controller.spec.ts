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
    expect(mail.sendOrderConfirmation).toHaveBeenCalledWith('amina@example.com', { ...order, customer: { name: 'Amina', email: 'amina@example.com' } });
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

describe('StoreCheckoutController linked guest record', () => {
  // A guest record that earlier anonymous orders created for this phone number, written by someone else.
  const guestOrder = { id: 'o1', number: 'JB-1', customer: { id: 'c1', name: 'Someone Else', phone: '+254700000001', email: 'someone.else@example.com' } };

  function build(created: boolean) {
    const orders = { checkout: jest.fn().mockResolvedValue({ order: guestOrder, created }) };
    const payments = { initiate: jest.fn().mockResolvedValue({ id: 'p1' }) };
    const mail = { sendOrderConfirmation: jest.fn() };
    const controller = new StoreCheckoutController(orders as never, payments as never, mail as never);
    return { call: () => controller.checkout({} as never, customer, 'idem-key-0001', res()), mail };
  }

  it('shows the account holder their own name and email on a new order, never the guest record', async () => {
    const { call, mail } = build(true);
    const out = await call();
    expect(out.order.customer).toMatchObject({ name: 'Amina', email: 'amina@example.com', phone: '+254700000001' });
    expect(JSON.stringify(out)).not.toContain('Someone Else');
    expect(JSON.stringify(out)).not.toContain('someone.else@example.com');
    expect(mail.sendOrderConfirmation).toHaveBeenCalledWith('amina@example.com', expect.objectContaining({ customer: expect.objectContaining({ name: 'Amina' }) }));
  });

  it('does the same on an idempotent replay, and does not email the receipt again', async () => {
    const { call, mail } = build(false);
    const out = await call();
    expect(out.order.customer).toMatchObject({ name: 'Amina', email: 'amina@example.com' });
    expect(JSON.stringify(out)).not.toContain('Someone Else');
    expect(JSON.stringify(out)).not.toContain('someone.else@example.com');
    expect(mail.sendOrderConfirmation).not.toHaveBeenCalled();
  });
});
