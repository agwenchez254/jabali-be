import { PaymentProvider } from '@prisma/client';

export interface InitiatePaymentInput {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  /** Normalised +2547XXXXXXXX payer number (may differ from the customer's contact number). */
  phone: string;
}

export interface InitiatePaymentResult {
  /** `pending` = waiting for the customer / provider callback. */
  status: 'pending' | 'failed';
  /** Provider's reference, e.g. Daraja CheckoutRequestID. Used to match callbacks. */
  providerRef: string | null;
  /** Safe-to-store provider response (never include secrets). */
  raw: Record<string, unknown>;
  /** Customer-facing message. */
  message: string;
}

/**
 * Payment provider adapter. To add a provider (Airtel Money, card gateway ...) implement this
 * interface and register it in PaymentsModule's PROVIDERS list.
 */
export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  /** false => the registry falls back to the mock provider for this payment method. */
  isConfigured(): boolean;
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
}
