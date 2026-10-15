import { VatSetting, VatSettingSchema } from '../content/settings.service';
import { Db } from '../prisma/prisma.service';

/**
 * Shelf prices in Kenya include VAT, so VAT is taken out of the total (never added on top).
 * Whole shillings: the VAT is rounded to the nearest shilling and the net is what is left,
 * so the two always add back to the total.
 */
export function extractVat(total: number, ratePercent: number): { vat: number; net: number } {
  if (total <= 0 || ratePercent <= 0) return { vat: 0, net: Math.max(total, 0) };
  const vat = Math.round((total * ratePercent) / (100 + ratePercent));
  return { vat, net: total - vat };
}

export interface OrderVat {
  ratePercent: number;
  amount: number;
  net: number;
  seller: { businessName: string; kraPin: string; address: string };
}

/** The VAT setting while it is switched on and valid; null otherwise (including when it was never set). */
export async function loadVat(db: Db): Promise<VatSetting | null> {
  const row = await db.siteSetting.findUnique({ where: { key: 'vat' } });
  const parsed = VatSettingSchema.safeParse(row?.value);
  return parsed.success && parsed.data.enabled ? parsed.data : null;
}

/** What to store on an order placed now: the rate, the VAT in its total and the seller details at this moment. */
export async function vatFor(db: Db, total: number) {
  const vat = await loadVat(db);
  if (!vat) return null;
  const { vat: amount } = extractVat(total, vat.ratePercent);
  return {
    rateBp: Math.round(vat.ratePercent * 100),
    amount,
    seller: { businessName: vat.businessName, kraPin: vat.kraPin, address: vat.address } satisfies OrderVat['seller'],
  };
}

/** The VAT block of an order as the API shows it, from the values fixed at checkout. */
export function vatView(o: { total: number; vatRateBp: number | null; vatAmount: number | null; vatSeller: unknown }): OrderVat | null {
  if (o.vatRateBp === null || o.vatAmount === null || !o.vatSeller) return null;
  return { ratePercent: o.vatRateBp / 100, amount: o.vatAmount, net: o.total - o.vatAmount, seller: o.vatSeller as OrderVat['seller'] };
}
