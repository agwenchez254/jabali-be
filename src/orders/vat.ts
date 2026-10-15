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
