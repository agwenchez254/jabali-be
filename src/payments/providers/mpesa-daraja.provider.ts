import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { InitiatePaymentInput, InitiatePaymentResult, PaymentProviderAdapter } from './provider';

const HOSTS = { sandbox: 'https://sandbox.safaricom.co.ke', production: 'https://api.safaricom.co.ke' } as const;

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.coerce.number() });
const stkPushSchema = z.object({
  MerchantRequestID: z.string(),
  CheckoutRequestID: z.string(),
  ResponseCode: z.string(),
  ResponseDescription: z.string().optional(),
  CustomerMessage: z.string().optional(),
});
const stkQuerySchema = z.object({
  ResponseCode: z.string().optional(),
  ResultCode: z.union([z.string(), z.number()]).optional(),
  ResultDesc: z.string().optional(),
  CheckoutRequestID: z.string().optional(),
});

export type StkQueryResult = z.infer<typeof stkQuerySchema>;

/** Daraja STK-push callback body (https://developer.safaricom.co.ke, "M-Pesa Express"). */
export const stkCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string(),
      CheckoutRequestID: z.string(),
      ResultCode: z.coerce.number(),
      ResultDesc: z.string(),
      CallbackMetadata: z
        .object({ Item: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() })) })
        .optional(),
    }),
  }),
});
export type StkCallback = z.infer<typeof stkCallbackSchema>['Body']['stkCallback'];

/**
 * M-Pesa Express (Lipa na M-Pesa Online) via Safaricom Daraja.
 * Inactive until MPESA_CONSUMER_KEY / SECRET / SHORTCODE / PASSKEY / CALLBACK_URL are set in the environment.
 */
@Injectable()
export class MpesaDarajaProvider implements PaymentProviderAdapter {
  readonly provider = 'mpesa' as const;
  private readonly log = new Logger('Daraja');
  private token?: { value: string; expiresAt: number };

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  isConfigured(): boolean {
    const m = this.cfg.mpesa;
    return Boolean(m.consumerKey && m.consumerSecret && m.shortcode && m.passkey && m.callbackUrl);
  }

  private get base(): string {
    return HOSTS[this.cfg.mpesa.env];
  }

  /** yyyyMMddHHmmss in Africa/Nairobi (UTC+3, no DST). */
  static timestamp(now = new Date()): string {
    const eat = new Date(now.getTime() + 3 * 3_600_000);
    return eat.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  }

  private password(timestamp: string): string {
    const m = this.cfg.mpesa;
    return Buffer.from(`${m.shortcode}${m.passkey}${timestamp}`).toString('base64');
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const { consumerKey, consumerSecret } = this.cfg.mpesa;
    const res = await fetch(`${this.base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Daraja auth failed (${res.status})`);
    const body = tokenSchema.parse(await res.json());
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async post<T extends z.ZodTypeAny>(path: string, payload: unknown, schema: T): Promise<z.infer<T>> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.log.warn(`Daraja ${path} -> ${res.status} ${JSON.stringify(json)}`);
      throw new Error(`Daraja request failed (${res.status})`);
    }
    return schema.parse(json) as z.infer<T>;
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const m = this.cfg.mpesa;
    const timestamp = MpesaDarajaProvider.timestamp();
    const msisdn = input.phone.replace('+', ''); // 2547XXXXXXXX
    try {
      const r = await this.post(
        '/mpesa/stkpush/v1/processrequest',
        {
          BusinessShortCode: m.shortcode,
          Password: this.password(timestamp),
          Timestamp: timestamp,
          TransactionType: m.transactionType,
          Amount: input.amount,
          PartyA: msisdn,
          PartyB: m.shortcode,
          PhoneNumber: msisdn,
          CallBackURL: m.callbackUrl,
          AccountReference: input.orderNumber.slice(0, 12),
          TransactionDesc: `Jabali ${input.orderNumber}`.slice(0, 13),
        },
        stkPushSchema,
      );
      if (r.ResponseCode !== '0') {
        return { status: 'failed', providerRef: null, raw: r, message: r.ResponseDescription ?? 'M-Pesa rejected the request' };
      }
      return {
        status: 'pending',
        providerRef: r.CheckoutRequestID,
        raw: r,
        message: r.CustomerMessage ?? 'Check your phone and enter your M-Pesa PIN.',
      };
    } catch (e) {
      this.log.error(`STK push failed for ${input.orderNumber}: ${String(e)}`);
      return { status: 'failed', providerRef: null, raw: { error: String(e) }, message: 'Could not reach M-Pesa. Please try again.' };
    }
  }

  /** Asks Daraja for the outcome of an STK push (used to reconcile missed callbacks). */
  async query(checkoutRequestId: string): Promise<StkQueryResult> {
    const timestamp = MpesaDarajaProvider.timestamp();
    return this.post(
      '/mpesa/stkpushquery/v1/query',
      {
        BusinessShortCode: this.cfg.mpesa.shortcode,
        Password: this.password(timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      },
      stkQuerySchema,
    );
  }
}
