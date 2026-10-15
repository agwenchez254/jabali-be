import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';

/** KRA PINs: a letter (A personal, P company), nine digits and a letter. */
export const KRA_PIN = /^[AP]\d{9}[A-Z]$/;

/** VAT on orders. Shelf prices are treated as VAT-inclusive. Enabling it needs the details a Kenyan receipt must show. */
export const VatSettingSchema = z
  .object({
    enabled: z.boolean(),
    ratePercent: z
      .number()
      .gt(0)
      .max(30)
      .refine((r) => Math.round(r * 100) / 100 === r, 'At most two decimals'),
    businessName: z.string().trim().max(120),
    kraPin: z.string().trim().max(11),
    address: z.string().trim().max(300),
  })
  .superRefine((v, ctx) => {
    if (!v.enabled) return;
    if (!v.businessName) ctx.addIssue({ code: 'custom', path: ['businessName'], message: 'Required to enable VAT' });
    if (!KRA_PIN.test(v.kraPin)) ctx.addIssue({ code: 'custom', path: ['kraPin'], message: 'Enter a valid KRA PIN, e.g. P051234567Z' });
  });

export type VatSetting = z.infer<typeof VatSettingSchema>;

/** Known site settings and their value shapes. */
export const SETTING_SCHEMAS = {
  freeDeliveryThreshold: z.number().int().min(0).nullable(),
  whatsappNumber: z.string().max(30),
  pickupAddress: z.string().max(300),
  announcementBar: z.object({ enabled: z.boolean(), text: z.string().max(200), link: z.string().max(300).optional(), linkLabel: z.string().max(40).optional() }),
  paymentMethods: z.array(z.enum(['cod', 'mpesa', 'airtel', 'card'])).min(1),
  giftFee: z.number().int().min(0).max(100_000),
  codZoneCodes: z.array(z.string().min(1).max(40)).max(50),
  vat: VatSettingSchema,
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;

export const SETTING_DESCRIPTIONS: Record<SettingKey, string> = {
  freeDeliveryThreshold: 'KES order amount (after discounts) above which delivery is free; null = never (zone.freeOver overrides)',
  whatsappNumber: 'Customer-care WhatsApp number, international format',
  pickupAddress: 'Address shown for pickup orders',
  announcementBar: '{ enabled, text, link?, linkLabel? } banner (link + linkLabel = call-to-action button) at the top of the storefront',
  paymentMethods: 'Payment methods offered at checkout: cod | mpesa | airtel | card',
  giftFee: 'KES added per gift-wrapped unit (wrap and card)',
  codZoneCodes: 'Codes of the delivery zones where pay-on-delivery is offered (pickup always allows it)',
  vat: '{ enabled, ratePercent, businessName, kraPin, address } VAT on receipts; prices are treated as VAT-inclusive',
};

/** Settings safe to show anyone: the seller details stay on the orders they belong to. */
export function publicSettings(all: Record<string, unknown>): Record<string, unknown> {
  const vat = all.vat as Partial<VatSetting> | undefined;
  if (!vat) return all;
  return { ...all, vat: { enabled: vat.enabled === true, ratePercent: vat.ratePercent ?? 16 } };
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.siteSetting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  describe() {
    return Object.keys(SETTING_SCHEMAS).map((key) => ({ key, description: SETTING_DESCRIPTIONS[key as SettingKey] }));
  }

  async set(key: string, value: unknown) {
    const schema = SETTING_SCHEMAS[key as SettingKey];
    if (!schema) throw new BadRequestException(`Unknown setting "${key}". Known: ${Object.keys(SETTING_SCHEMAS).join(', ')}`);
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        code: 'validation_failed',
        errors: parsed.error.issues.map((i) => ({ field: ['value', ...i.path].join('.'), message: i.message })),
      });
    }
    const json = parsed.data as Prisma.InputJsonValue | null;
    const row = await this.prisma.siteSetting.upsert({
      where: { key },
      update: { value: json ?? Prisma.JsonNull },
      create: { key, value: json ?? Prisma.JsonNull },
    });
    return { key: row.key, value: row.value, updatedAt: row.updatedAt };
  }
}
