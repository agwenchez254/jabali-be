export interface DeliveryQuote {
  county: string;
  zone: { id: string; code: string; name: string; eta: string; etaDays: number };
  fee: number;
  freeOver: number | null;
  free: boolean;
  /** KES still needed to reach free delivery (null when there is no threshold). */
  amountToFree: number | null;
}
