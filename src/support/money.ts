/**
 * Money helpers for checkout assertions.
 *
 * Floating-point arithmetic is unreliable for currency (0.1 + 0.2 !== 0.3), so every
 * comparison in the suite goes through integer cents.
 */

const AMOUNT_PATTERN = /\d[\d,]*(?:\.\d+)?/;

/** Extracts the first amount from text such as "$29.99" or "Item total: $39.98". */
export function parsePrice(text: string): number {
  const match = AMOUNT_PATTERN.exec(text);
  if (!match) {
    throw new Error(`No price found in "${text}"`);
  }
  return Number(match[0].replaceAll(',', ''));
}

/** Converts a dollar amount to integer cents, rounding away float noise. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Sums dollar amounts and returns the result in integer cents. */
export function sumCents(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + toCents(amount), 0);
}
