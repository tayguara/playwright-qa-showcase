import { test, expect, APIRequestContext } from '@playwright/test';
import { z } from 'zod';

const bookingSchema = z.object({
  firstname: z.string(),
  lastname: z.string(),
  totalprice: z.number(),
  depositpaid: z.boolean(),
  bookingdates: z.object({ checkin: z.string(), checkout: z.string() }),
  additionalneeds: z.string().optional(),
});

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function newBooking(overrides: Record<string, unknown> = {}) {
  return {
    firstname: `F${uniq()}`,
    lastname: `L${uniq()}`,
    totalprice: 123,
    depositpaid: true,
    bookingdates: { checkin: '2026-01-01', checkout: '2026-01-10' },
    additionalneeds: 'Breakfast',
    ...overrides,
  };
}

async function getToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/auth', {
    data: { username: 'admin', password: 'password123' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.token).toBeTruthy();
  return body.token;
}

async function createBooking(request: APIRequestContext, data = newBooking()) {
  const res = await request.post('/booking', { data });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.bookingid).toBe('number');
  return { id: body.bookingid as number, data, body };
}

test.describe('Restful Booker', () => {
  let token: string;
  const created: number[] = [];

  test.beforeAll(async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    token = await getToken(ctx);
    await ctx.dispose();
  });

  test.afterAll(async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    for (const id of created) {
      await ctx.delete(`/booking/${id}`, { headers: { Cookie: `token=${token}` } });
    }
    await ctx.dispose();
  });

  const make = async (request: APIRequestContext, data = newBooking()) => {
    const b = await createBooking(request, data);
    created.push(b.id);
    return b;
  };
  const auth = () => ({ Cookie: `token=${token}` });

  test('auth: valid credentials return a token', async ({ request }) => {
    const res = await request.post('/auth', {
      data: { username: 'admin', password: 'password123' },
    });
    expect(res.status()).toBe(200);
    expect(typeof (await res.json()).token).toBe('string');
  });

  test('auth: invalid credentials do not return a token', async ({ request }) => {
    const res = await request.post('/auth', {
      data: { username: 'admin', password: 'wrong' },
    });
    const body = await res.json();
    expect(body.token).toBeUndefined();
    expect(body.reason).toBeTruthy();
  });

  test('create a booking and read it back', async ({ request }) => {
    const { id, data, body } = await make(request);
    expect(body.booking).toEqual(data);

    const res = await request.get(`/booking/${id}`);
    expect(res.status()).toBe(200);
    const got = await res.json();
    bookingSchema.parse(got);
    expect(got).toEqual(data);
  });

  test('find a booking by first name and last name', async ({ request }) => {
    const { id, data } = await make(request);
    const res = await request.get('/booking', {
      params: { firstname: data.firstname, lastname: data.lastname },
    });
    expect(res.status()).toBe(200);
    const list: { bookingid: number }[] = await res.json();
    expect(list.map((b) => b.bookingid)).toContain(id);

    const none = await request.get('/booking', {
      params: { firstname: data.firstname, lastname: `nobody${uniq()}` },
    });
    expect(await none.json()).toEqual([]);
  });

  test('PUT fully replaces a booking', async ({ request }) => {
    const { id } = await make(request);
    const replacement = newBooking({
      totalprice: 999,
      depositpaid: false,
      additionalneeds: 'Lunch',
      bookingdates: { checkin: '2026-02-01', checkout: '2026-02-05' },
    });
    const res = await request.put(`/booking/${id}`, { data: replacement, headers: auth() });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual(replacement);

    const got = await (await request.get(`/booking/${id}`)).json();
    expect(got).toEqual(replacement);
  });

  test('PATCH partially updates a booking', async ({ request }) => {
    const { id, data } = await make(request);
    const res = await request.patch(`/booking/${id}`, {
      data: { firstname: 'Patched', totalprice: 555 },
      headers: auth(),
    });
    expect(res.status()).toBe(200);
    const expected = { ...data, firstname: 'Patched', totalprice: 555 };
    expect(await res.json()).toEqual(expected);
    expect(await (await request.get(`/booking/${id}`)).json()).toEqual(expected);
  });

  test('PUT without a token is rejected with 403 and changes nothing', async ({ request }) => {
    const { id, data } = await make(request);
    const res = await request.put(`/booking/${id}`, { data: newBooking({ firstname: 'Hacker' }) });
    expect(res.status()).toBe(403);
    expect(await (await request.get(`/booking/${id}`)).json()).toEqual(data);
  });

  test('DELETE answers 201 and the booking is gone', async ({ request }) => {
    const { id } = await make(request);
    const res = await request.delete(`/booking/${id}`, { headers: auth() });
    expect(res.status()).toBe(201);
    expect((await request.get(`/booking/${id}`)).status()).toBe(404);
  });
});
