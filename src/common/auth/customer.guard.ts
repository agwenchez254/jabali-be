import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { SecurityLogService } from '../security-log/security-log.service';
import { CustomerAuthUser, CustomerTokenPayload } from './auth.types';

/** Requires a valid customer access token (`typ: "customer"`). Staff tokens are rejected. */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly security: SecurityLogService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { customer?: CustomerAuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    let payload: CustomerTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<CustomerTokenPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== 'customer') {
      this.security.log('token_type_rejected', { ip: req.ip, expected: 'customer' });
      throw new UnauthorizedException('Invalid or expired token');
    }
    req.customer = { accountId: payload.sub, customerId: payload.cid, email: payload.email, name: payload.name };
    return true;
  }
}
