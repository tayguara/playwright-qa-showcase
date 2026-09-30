import { test, expect } from '@playwright/test';
import { buildBooking } from '../../src/data/bookingBuilder';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

test.describe('bookingBuilder', { tag: '@unit' }, () => {
  test('generates a unique, recognizable lastname on every call', () => {
    const names = new Set(Array.from({ length: 50 }, () => buildBooking().lastname));

    expect(names.size).toBe(50);
    for (const name of names) {
      expect(name).toMatch(/^Showcase-[0-9a-f]{8}$/);
    }
  });

  test('uses ISO YYYY-MM-DD dates', () => {
    const { checkin, checkout } = buildBooking().bookingdates;

    expect(checkin).toMatch(ISO_DATE);
    expect(checkout).toMatch(ISO_DATE);
  });

  test('uses future dates with checkout after checkin', () => {
    const { checkin, checkout } = buildBooking().bookingdates;

    // ISO dates sort lexicographically, so string comparison is enough.
    expect(checkin > todayIso()).toBe(true);
    expect(checkout > checkin).toBe(true);
  });

  test('produces a complete payload with sensible values', () => {
    const booking = buildBooking();

    expect(booking.firstname).toBeTruthy();
    expect(booking.totalprice).toBeGreaterThan(0);
    expect(Number.isInteger(booking.totalprice)).toBe(true);
    expect(typeof booking.depositpaid).toBe('boolean');
    expect(booking.additionalneeds).toBeTruthy();
  });

  test('applies top-level overrides', () => {
    const booking = buildBooking({ firstname: 'Ada', totalprice: 42, depositpaid: false });

    expect(booking).toMatchObject({ firstname: 'Ada', totalprice: 42, depositpaid: false });
    expect(booking.lastname).toMatch(/^Showcase-/);
  });

  test('applies nested date overrides without touching other fields', () => {
    const booking = buildBooking({
      bookingdates: { checkin: '2031-01-10', checkout: '2031-01-12' },
    });

    expect(booking.bookingdates).toEqual({ checkin: '2031-01-10', checkout: '2031-01-12' });
  });

  test('does not share nested objects between calls', () => {
    const first = buildBooking();
    const second = buildBooking();

    expect(first.bookingdates).not.toBe(second.bookingdates);
  });
});
