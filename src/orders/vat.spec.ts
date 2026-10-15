import { extractVat } from './vat';

describe('extractVat (prices already include VAT)', () => {
  it('takes 16/116 out of the total', () => {
    expect(extractVat(116, 16)).toEqual({ vat: 16, net: 100 });
  });

  it('rounds the VAT to the nearest shilling, half up', () => {
    expect(extractVat(1000, 16)).toEqual({ vat: 138, net: 862 }); // 137.93
    expect(extractVat(1, 16)).toEqual({ vat: 0, net: 1 });
    expect(extractVat(29, 16)).toEqual({ vat: 4, net: 25 }); // exactly 4.0
    expect(extractVat(58, 16)).toEqual({ vat: 8, net: 50 });
  });

  it('is zero for an empty total or a zero rate', () => {
    expect(extractVat(0, 16)).toEqual({ vat: 0, net: 0 });
    expect(extractVat(5000, 0)).toEqual({ vat: 0, net: 5000 });
  });

  it('always splits the total exactly into VAT and net', () => {
    for (const rate of [16, 8, 1.5]) {
      for (let total = 0; total <= 500; total++) {
        const { vat, net } = extractVat(total, rate);
        expect(vat + net).toBe(total);
        expect(vat).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
