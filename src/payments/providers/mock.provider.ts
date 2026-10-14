import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InitiatePaymentInput, InitiatePaymentResult, PaymentProviderAdapter } from './provider';

/**
 * Development stand-in for online providers when real credentials are not configured.
 * It never moves money: staff confirm payment manually via POST /admin/orders/:id/transition {to:"paid"}.
 */
@Injectable()
export class MockProvider implements PaymentProviderAdapter {
  readonly provider = 'mpesa' as const;
  isConfigured(): boolean {
    return true;
  }
  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    return {
      status: 'pending',
      providerRef: `MOCK-${randomUUID().slice(0, 8)}`,
      raw: { mock: true, phone: input.phone, amount: input.amount },
      message: 'Mock payment created. No real payment request was sent.',
    };
  }
}
