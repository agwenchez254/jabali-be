import { OrderStatus, PaymentProvider } from '@prisma/client';

/**
 * Order status state machine.
 *
 *   pending -> paid -> packed -> shipped -> delivered -> refunded
 *      |         |        |
 *      |         |        +--> cancelled
 *      |         +-----------> cancelled | refunded
 *      +--(COD only)--> packed
 *      +--------------> cancelled
 *
 * `cancelled` and `refunded` are terminal. Cash-on-delivery orders may be packed before they are paid.
 */
const BASE: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['packed', 'cancelled', 'refunded'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

export function allowedTransitions(from: OrderStatus, paymentMethod: PaymentProvider): OrderStatus[] {
  const next = [...BASE[from]];
  if (from === 'pending' && paymentMethod === 'cod') next.push('packed');
  return next;
}

export function canTransition(from: OrderStatus, to: OrderStatus, paymentMethod: PaymentProvider): boolean {
  return allowedTransitions(from, paymentMethod).includes(to);
}
