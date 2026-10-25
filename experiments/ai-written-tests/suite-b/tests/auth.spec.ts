import { test, expect, tokenSchema } from './helpers';
import { z } from 'zod';

// Regression: /auth stops issuing a usable token for valid admin credentials.
test('valid credentials return a token that authorises a write', async ({ request, createBooking }) => {
  const res = await request.post('/auth', { data: { username: 'admin', password: 'password123' } });
  expect(res.status()).toBe(200);
  const { token } = tokenSchema.parse(await res.json());

  const { id, data } = await createBooking();
  const put = await request.put(`/booking/${id}`, {
    headers: { Cookie: `token=${token}` },
    data: { ...data, totalprice: 222 },
  });
  expect(put.status()).toBe(200);
  const after = await (await request.get(`/booking/${id}`)).json();
  expect(after.totalprice).toBe(222);
});

// Regression: /auth issues a token for a wrong password.
test('wrong password yields no token', async ({ request }) => {
  const res = await request.post('/auth', { data: { username: 'admin', password: 'wrong-password' } });
  const body = z.object({ reason: z.string() }).parse(await res.json());
  expect(body.reason).toBe('Bad credentials');
  expect(body).not.toHaveProperty('token');
});

// Regression: /auth issues a token for an unknown user.
test('unknown user yields no token', async ({ request }) => {
  const res = await request.post('/auth', { data: { username: 'nobody', password: 'password123' } });
  const body = z.object({ reason: z.string() }).parse(await res.json());
  expect(body).not.toHaveProperty('token');
});

// Regression: a made-up token is accepted for write operations.
test('an invalid token is rejected and the booking is unchanged', async ({ request, booking }) => {
  const res = await request.put(`/booking/${booking.id}`, {
    headers: { Cookie: 'token=not-a-real-token' },
    data: { ...booking.data, firstname: 'Hacked' },
  });
  expect(res.status()).toBe(403);
  const after = await (await request.get(`/booking/${booking.id}`)).json();
  expect(after.firstname).toBe(booking.data.firstname);
});
