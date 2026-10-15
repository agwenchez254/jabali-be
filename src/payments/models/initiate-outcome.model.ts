import { PaymentProvider } from '@prisma/client';

export interface InitiateOutcome {
  status: 'pending' | 'failed';
  provider: PaymentProvider;
  message: string;
  /** Daraja CheckoutRequestID (or mock reference) the client can poll with via order tracking. */
  reference: string | null;
  mock: boolean;
  /** The number that was prompted. */
  payerPhone: string;
}
