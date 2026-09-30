import { randomUUID } from 'node:crypto';
import type { Booking } from '../api/schemas';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Formats a date as YYYY-MM-DD (UTC). */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Builds a valid booking payload with data that is unique per call.
 *
 * The API is a shared public sandbox, so every test creates its own booking and finds it again
 * through the unique lastname. Dates are relative to today so they never drift into the past.
 */
export function buildBooking(overrides: Partial<Booking> = {}): Booking {
  const checkin = new Date(Date.now() + 30 * DAY_MS);
  const checkout = new Date(checkin.getTime() + 3 * DAY_MS);

  return {
    firstname: 'Showcase',
    lastname: `Showcase-${randomUUID().slice(0, 8)}`,
    totalprice: 150,
    depositpaid: true,
    bookingdates: { checkin: toIsoDate(checkin), checkout: toIsoDate(checkout) },
    additionalneeds: 'Breakfast',
    ...overrides,
  };
}
