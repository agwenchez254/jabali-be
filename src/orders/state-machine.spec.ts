import { OrderStatus } from '@prisma/client';
import { allowedTransitions, canTransition } from './state-machine';

describe('order state machine', () => {
  it('follows the happy path for prepaid orders', () => {
    expect(canTransition('pending', 'paid', 'mpesa')).toBe(true);
    expect(canTransition('paid', 'packed', 'mpesa')).toBe(true);
    expect(canTransition('packed', 'shipped', 'mpesa')).toBe(true);
    expect(canTransition('shipped', 'delivered', 'mpesa')).toBe(true);
    expect(canTransition('delivered', 'refunded', 'mpesa')).toBe(true);
  });

  it('only COD orders can skip payment before packing', () => {
    expect(canTransition('pending', 'packed', 'cod')).toBe(true);
    expect(canTransition('pending', 'packed', 'mpesa')).toBe(false);
  });

  it('cannot skip steps', () => {
    expect(canTransition('pending', 'shipped', 'cod')).toBe(false);
    expect(canTransition('paid', 'delivered', 'mpesa')).toBe(false);
    expect(canTransition('packed', 'delivered', 'mpesa')).toBe(false);
  });

  it('cancelled and refunded are terminal', () => {
    const all: OrderStatus[] = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'];
    for (const to of all) {
      expect(canTransition('cancelled', to, 'cod')).toBe(false);
      expect(canTransition('refunded', to, 'cod')).toBe(false);
    }
  });

  it('shipped orders cannot be cancelled (they must be delivered or returned via refund later)', () => {
    expect(canTransition('shipped', 'cancelled', 'mpesa')).toBe(false);
  });

  it('cancel is allowed until the parcel ships', () => {
    for (const from of ['pending', 'paid', 'packed'] as OrderStatus[]) {
      expect(canTransition(from, 'cancelled', 'mpesa')).toBe(true);
    }
  });

  it('does not allow self transitions', () => {
    expect(allowedTransitions('paid', 'mpesa')).not.toContain('paid');
  });
});
