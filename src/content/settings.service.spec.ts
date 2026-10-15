import { publicSettings, SETTING_SCHEMAS } from './settings.service';

const vat = SETTING_SCHEMAS.vat;
const on = { enabled: true, ratePercent: 16, businessName: 'Jabali Menswear Ltd', kraPin: 'P051234567Z', address: 'Moi Avenue, Nairobi' };

describe('vat setting', () => {
  it('accepts a complete, enabled configuration', () => {
    expect(vat.safeParse(on).success).toBe(true);
  });

  it('accepts a disabled configuration with blank seller details', () => {
    expect(vat.safeParse({ enabled: false, ratePercent: 16, businessName: '', kraPin: '', address: '' }).success).toBe(true);
  });

  it('refuses to enable VAT without a business name or a valid KRA PIN', () => {
    const noName = vat.safeParse({ ...on, businessName: ' ' });
    expect(noName.success).toBe(false);
    const badPin = vat.safeParse({ ...on, kraPin: 'A12' });
    expect(badPin.success).toBe(false);
    if (!badPin.success) expect(badPin.error.issues[0].path).toEqual(['kraPin']);
    expect(vat.safeParse({ ...on, kraPin: 'p051234567z' }).success).toBe(false);
  });

  it('keeps the rate above 0 and at most 30', () => {
    expect(vat.safeParse({ ...on, ratePercent: 0 }).success).toBe(false);
    expect(vat.safeParse({ ...on, ratePercent: 31 }).success).toBe(false);
    expect(vat.safeParse({ ...on, ratePercent: 16.005 }).success).toBe(false);
    expect(vat.safeParse({ ...on, ratePercent: 8.5 }).success).toBe(true);
  });
});

describe('publicSettings', () => {
  it('shows the public part of vat and keeps seller details private', () => {
    const out = publicSettings({ giftFee: 300, vat: on });
    expect(out).toEqual({ giftFee: 300, vat: { enabled: true, ratePercent: 16 } });
    expect(JSON.stringify(out)).not.toContain('P051234567Z');
  });

  it('leaves settings without vat untouched', () => {
    expect(publicSettings({ giftFee: 300 })).toEqual({ giftFee: 300 });
  });
});
