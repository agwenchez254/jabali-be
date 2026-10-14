import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { perHour, RateLimit, RateLimitGuard, SkipRateLimit } from './rate-limit.guard';

class Routes {
  @RateLimit(perHour('hourly', 2, 'email')) limited(): void {}
  @SkipRateLimit() skipped(): void {}
}

const ctx = (handler: () => void, body: unknown = {}): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ ip: '10.0.0.1', body, route: { path: '/x' } }), getResponse: () => ({ setHeader: jest.fn() }) }),
  }) as unknown as ExecutionContext;

const guard = () => new RateLimitGuard(new Reflector(), { log: jest.fn() } as never, { rateLimitEnabled: true } as never);
const routes = new Routes();

describe('RateLimitGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('holds an hourly rule across minutes: the third request for one email is refused five minutes later', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const g = guard();
    const body = { email: 'a@example.com' };
    expect(g.canActivate(ctx(routes.limited, body))).toBe(true);
    expect(g.canActivate(ctx(routes.limited, body))).toBe(true);
    now.mockReturnValue(1_000_000 + 5 * 60_000);
    expect(() => g.canActivate(ctx(routes.limited, body))).toThrow(/Too many requests/);
    // another email has its own allowance
    expect(g.canActivate(ctx(routes.limited, { email: 'b@example.com' }))).toBe(true);
  });

  it('never throttles a route marked SkipRateLimit, however many requests arrive', () => {
    const g = guard();
    for (let i = 0; i < 300; i++) expect(g.canActivate(ctx(routes.skipped))).toBe(true);
  });
});
