import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerAuthUser } from './auth.types';

export const CurrentCustomer = createParamDecorator((_: unknown, ctx: ExecutionContext): CustomerAuthUser => {
  return ctx.switchToHttp().getRequest<Request & { customer: CustomerAuthUser }>().customer;
});
