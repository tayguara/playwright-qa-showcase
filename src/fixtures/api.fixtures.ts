import { test as base, expect } from '@playwright/test';
import { BookingClient } from '../api/BookingClient';
import { authSuccessSchema, createdBookingSchema, type Booking } from '../api/schemas';
import { env } from '../../config/env';
import { buildBooking } from '../data/bookingBuilder';

/** A booking created for one test, plus the payload that was sent for it. */
export interface CreatedBookingFixture {
  id: number;
  payload: Booking;
}

interface ApiFixtures {
  bookingClient: BookingClient;
  booking: CreatedBookingFixture;
}

interface ApiWorkerFixtures {
  authToken: string;
}

// Statuses a teardown DELETE may legitimately answer: 201 (deleted), or 404/405 when the test
// already deleted the booking (this API answers 405 for a missing booking on DELETE).
const TOLERATED_CLEANUP_STATUSES = [201, 404, 405];

export const test = base.extend<ApiFixtures, ApiWorkerFixtures>({
  // Worker-scoped: one login per worker. It is also the first request of the worker, so it warms
  // up the Heroku dyno before any assertion-bearing request is made.
  // A worker fixture cannot read the project's `use` options, so baseURL and Accept mirror the
  // `api` project in playwright.config.ts.
  authToken: [
    async ({ playwright }, use) => {
      const context = await playwright.request.newContext({
        baseURL: env.booker.baseUrl,
        extraHTTPHeaders: { Accept: 'application/json' },
      });
      try {
        const response = await new BookingClient(context).auth(
          env.booker.username,
          env.booker.password,
        );
        expect(response.status(), 'POST /auth during worker warm-up').toBe(200);
        const { token } = authSuccessSchema.parse(await response.json());
        await use(token);
      } finally {
        await context.dispose();
      }
    },
    { scope: 'worker' },
  ],

  bookingClient: async ({ request }, use) => {
    await use(new BookingClient(request));
  },

  // Creates a unique booking for the test and removes it afterwards.
  booking: async ({ bookingClient, authToken }, use) => {
    const payload = buildBooking();
    const createResponse = await bookingClient.create(payload);
    expect(createResponse.status(), 'POST /booking while preparing the fixture').toBe(200);
    const { bookingid } = createdBookingSchema.parse(await createResponse.json());

    await use({ id: bookingid, payload });

    const cleanup = await bookingClient.delete(bookingid, authToken);
    expect(TOLERATED_CLEANUP_STATUSES).toContain(cleanup.status());
  },
});

export { expect };
