import { DomainError } from '../common/problem-details.filter';
import { OrdersService } from './orders.service';

describe('OrdersService.checkout idempotency ownership', () => {
  const existing = { id: 'o1', customerId: 'customer-A', idempotencyKey: 'key-0000001' };
  const prisma = { order: { findUnique: jest.fn().mockResolvedValue(existing) } };
  const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);

  it("refuses to replay another customer's order for the same key", async () => {
    await expect(service.checkout({} as never, 'key-0000001', 'customer-B')).rejects.toBeInstanceOf(DomainError);
    await expect(service.checkout({} as never, 'key-0000001', 'customer-B')).rejects.toMatchObject({ code: 'idempotency_key_conflict' });
    await expect(service.checkout({} as never, 'key-0000001', 'customer-B')).rejects.toHaveProperty('status', 409);
  });
});
