import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CustomerAuthGuard } from './customer.guard';
import { JwtAuthGuard } from './guards';

const jwt = new JwtService({ secret: 'x'.repeat(40), signOptions: { expiresIn: 60 } });

const ctx = (token?: string) => {
  const req: Record<string, unknown> = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  return { req, context: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
};

const staffToken = () => jwt.signAsync({ sub: 's1', email: 's@x.co', name: 'S', role: 'owner', permissions: ['order:read'] });
const customerToken = () => jwt.signAsync({ sub: 'a1', typ: 'customer', cid: 'c1', email: 'c@x.co', name: 'C' });

describe('JwtAuthGuard (staff)', () => {
  const guard = new JwtAuthGuard(jwt, { log: jest.fn() } as never);

  it('accepts a staff token', async () => {
    const { req, context } = ctx(await staffToken());
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req.user as { id: string }).id).toBe('s1');
  });

  it('rejects a customer token', async () => {
    const { context } = ctx(await customerToken());
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('CustomerAuthGuard', () => {
  const findAccount = jest.fn().mockResolvedValue({ status: 'active' });
  const guard = new CustomerAuthGuard(jwt, { log: jest.fn() } as never, { customerAccount: { findUnique: findAccount } } as never);

  it('rejects a deactivated account even with a valid token', async () => {
    findAccount.mockResolvedValueOnce({ status: 'disabled' });
    const { context } = ctx(await customerToken());
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a customer token and exposes the customer', async () => {
    const { req, context } = ctx(await customerToken());
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.customer).toEqual({ accountId: 'a1', customerId: 'c1', email: 'c@x.co', name: 'C' });
  });

  it('rejects a staff token', async () => {
    const { context } = ctx(await staffToken());
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing, malformed or expired token', async () => {
    await expect(guard.canActivate(ctx().context)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx('not-a-jwt').context)).rejects.toBeInstanceOf(UnauthorizedException);
    const expired = await new JwtService({ secret: 'x'.repeat(40) }).signAsync({ sub: 'a1', typ: 'customer', cid: 'c1', email: 'c@x.co', name: 'C' }, { expiresIn: -10 });
    await expect(guard.canActivate(ctx(expired).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
