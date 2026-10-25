import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { z } from 'zod';

export const bookingSchema = z.object({
  firstname: z.string(),
  lastname: z.string(),
  totalprice: z.number(),
  depositpaid: z.boolean(),
  bookingdates: z.object({ checkin: z.string(), checkout: z.string() }),
  additionalneeds: z.string().optional(),
});
export type Booking = z.infer<typeof bookingSchema>;

export const createdSchema = z.object({ bookingid: z.number().int(), booking: bookingSchema });
export const tokenSchema = z.object({ token: z.string().min(1) });
export const idListSchema = z.array(z.object({ bookingid: z.number().int() }));

let counter = 0;
export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${process.pid}${counter}${Math.random().toString(36).slice(2, 6)}`;
}

export function newBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    firstname: uniqueName('Fn'),
    lastname: uniqueName('Ln'),
    totalprice: 111,
    depositpaid: true,
    bookingdates: { checkin: '2030-01-01', checkout: '2030-01-10' },
    additionalneeds: 'Breakfast',
    ...overrides,
  };
}

export async function getToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/auth', { data: { username: 'admin', password: 'password123' } });
  expect(res.status()).toBe(200);
  return tokenSchema.parse(await res.json()).token;
}

type Fixtures = {
  token: string;
  booking: { id: number; data: Booking };
  /** Creates a booking via the API; all are deleted at teardown. */
  createBooking: (data?: Booking) => Promise<{ id: number; data: Booking }>;
  /** Registers an id created outside createBooking for teardown deletion. */
  trackBooking: (id: number) => void;
  trackedIds: number[];
};

export const test = base.extend<Fixtures>({
  token: async ({ request }, use) => {
    await use(await getToken(request));
  },
  trackedIds: async ({ request, token }, use) => {
    const ids: number[] = [];
    await use(ids);
    for (const id of ids) {
      // 201 on delete, 404 if the test already removed it; both are fine.
      await request.delete(`/booking/${id}`, { headers: { Cookie: `token=${token}` } });
    }
  },
  trackBooking: async ({ trackedIds }, use) => {
    await use((id) => void trackedIds.push(id));
  },
  createBooking: async ({ request, trackedIds }, use) => {
    await use(async (data = newBooking()) => {
      const res = await request.post('/booking', { data });
      expect(res.status()).toBe(200);
      const body = createdSchema.parse(await res.json());
      trackedIds.push(body.bookingid);
      return { id: body.bookingid, data };
    });
  },
  booking: async ({ createBooking }, use) => {
    await use(await createBooking());
  },
});

export { expect };
