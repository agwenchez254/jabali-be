import { Injectable } from '@nestjs/common';
import { InitiatePaymentInput, InitiatePaymentResult, PaymentProviderAdapter } from './provider';

/** Cash on delivery: nothing to initiate; the payment is settled when the order is delivered. */
@Injectable()
export class CodProvider implements PaymentProviderAdapter {
  readonly provider = 'cod' as const;
  isConfigured(): boolean {
    return true;
  }
  async initiate(_input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    void _input;
    return { status: 'pending', providerRef: null, raw: { method: 'cod' }, message: 'Pay in cash when your order arrives.' };
  }
}
