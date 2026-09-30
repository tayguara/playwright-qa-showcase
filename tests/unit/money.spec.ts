import { test, expect } from '@playwright/test';
import { parsePrice, sumCents, toCents } from '../../src/support/money';

test.describe('money helpers', { tag: '@unit' }, () => {
  test.describe('parsePrice', () => {
    test('parses a plain currency string', () => {
      expect(parsePrice('$29.99')).toBe(29.99);
    });

    test('extracts the amount from a labelled summary line', () => {
      expect(parsePrice('Item total: $39.98')).toBe(39.98);
      expect(parsePrice('Tax: $3.20')).toBe(3.2);
    });

    test('parses whole amounts and thousands separators', () => {
      expect(parsePrice('$7')).toBe(7);
      expect(parsePrice('$1,234.50')).toBe(1234.5);
    });

    test('throws when the text contains no amount', () => {
      expect(() => parsePrice('no price here')).toThrow(/no price/i);
    });
  });

  test.describe('toCents', () => {
    test('converts dollars to integer cents without float drift', () => {
      expect(toCents(29.99)).toBe(2999);
      expect(toCents(0.29)).toBe(29); // 0.29 * 100 === 28.999999999999996
      expect(toCents(1.15)).toBe(115); // 1.15 * 100 === 114.99999999999999
    });
  });

  test.describe('sumCents', () => {
    test('sums prices in integer cents', () => {
      expect(sumCents([29.99, 9.99])).toBe(3998);
    });

    test('avoids the classic float error', () => {
      expect(0.1 + 0.2).not.toBe(0.3);
      expect(sumCents([0.1, 0.2])).toBe(30);
    });

    test('returns 0 for an empty list', () => {
      expect(sumCents([])).toBe(0);
    });
  });

  test('order total equals item total plus tax, in cents', () => {
    const itemTotal = parsePrice('Item total: $32.39');
    const tax = parsePrice('Tax: $2.59');
    const total = parsePrice('Total: $34.98');

    expect(sumCents([itemTotal, tax])).toBe(toCents(total));
  });
});
