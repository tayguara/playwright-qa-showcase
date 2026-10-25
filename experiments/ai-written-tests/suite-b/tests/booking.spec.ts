import { test, expect, newBooking, bookingSchema, createdSchema, idListSchema } from './helpers';

// Regression: POST /booking drops or alters submitted fields, or the booking is not persisted.
test('create a booking and read it back', async ({ request, trackBooking }) => {
  const data = newBooking();
  const res = await request.post('/booking', { data });
  expect(res.status()).toBe(200);
  const created = createdSchema.parse(await res.json());
  trackBooking(created.bookingid);
  expect(created.booking).toEqual(data);

  const get = await request.get(`/booking/${created.bookingid}`);
  expect(get.status()).toBe(200);
  expect(bookingSchema.parse(await get.json())).toEqual(data);
});

// Regression: GET of a non-existent booking returns something other than 404.
test('reading an unknown booking returns 404', async ({ request }) => {
  const res = await request.get('/booking/999999999');
  expect(res.status()).toBe(404);
});

// Regression: creating a booking with missing required fields succeeds instead of failing.
test('creating a booking with an incomplete payload is rejected', async ({ request }) => {
  const res = await request.post('/booking', { data: { firstname: 'OnlyName' } });
  expect(res.ok()).toBe(false);
});

// Regression: the firstname/lastname filter ignores a parameter or returns unrelated bookings.
test('find a booking by first and last name', async ({ request, createBooking }) => {
  const { id, data } = await createBooking();
  await createBooking(newBooking()); // a decoy that must not match

  const res = await request.get('/booking', {
    params: { firstname: data.firstname, lastname: data.lastname },
  });
  expect(res.status()).toBe(200);
  const ids = idListSchema.parse(await res.json());
  expect(ids).toEqual([{ bookingid: id }]);
});

// Regression: the filter returns bookings for a non-matching name combination.
test('searching with a non-matching last name finds nothing', async ({ request, booking }) => {
  const res = await request.get('/booking', {
    params: { firstname: booking.data.firstname, lastname: 'NoSuchLastName' },
  });
  expect(res.status()).toBe(200);
  expect(idListSchema.parse(await res.json())).toEqual([]);
});

// Regression: PUT merges instead of replacing, or does not persist the new values.
test('PUT fully replaces the booking', async ({ request, booking, token }) => {
  const replacement = newBooking({
    totalprice: 999,
    depositpaid: false,
    bookingdates: { checkin: '2031-02-02', checkout: '2031-02-12' },
    additionalneeds: 'Dinner',
  });
  const res = await request.put(`/booking/${booking.id}`, {
    headers: { Cookie: `token=${token}` },
    data: replacement,
  });
  expect(res.status()).toBe(200);
  expect(bookingSchema.parse(await res.json())).toEqual(replacement);

  const get = await request.get(`/booking/${booking.id}`);
  expect(bookingSchema.parse(await get.json())).toEqual(replacement);
});

// Regression: PUT keeps old optional values that the replacement omits (known sandbox bug, expected to fail).
test('PUT drops optional fields omitted from the replacement', async ({ request, booking, token }) => {
  test.fail(true, 'Restful Booker keeps additionalneeds when a PUT omits it');
  const replacement = newBooking();
  delete replacement.additionalneeds;
  const res = await request.put(`/booking/${booking.id}`, {
    headers: { Cookie: `token=${token}` },
    data: replacement,
  });
  expect(res.status()).toBe(200);
  const get = await request.get(`/booking/${booking.id}`);
  expect(bookingSchema.parse(await get.json())).toEqual(replacement);
});

// Regression: PUT with a valid token on a non-existent booking succeeds.
test('PUT on an unknown booking is not successful', async ({ request, token }) => {
  const res = await request.put('/booking/999999999', {
    headers: { Cookie: `token=${token}` },
    data: newBooking(),
  });
  expect(res.ok()).toBe(false);
});

// Regression: PATCH overwrites fields that were not sent, or does not persist the sent ones.
test('PATCH updates only the given fields', async ({ request, booking, token }) => {
  const res = await request.patch(`/booking/${booking.id}`, {
    headers: { Cookie: `token=${token}` },
    data: { firstname: 'Patched', totalprice: 5 },
  });
  expect(res.status()).toBe(200);
  const expected = { ...booking.data, firstname: 'Patched', totalprice: 5 };
  expect(bookingSchema.parse(await res.json())).toEqual(expected);

  const get = await request.get(`/booking/${booking.id}`);
  expect(bookingSchema.parse(await get.json())).toEqual(expected);
});

// Regression: PATCH works without authentication.
test('PATCH without a token is rejected and changes nothing', async ({ request, booking }) => {
  const res = await request.patch(`/booking/${booking.id}`, { data: { firstname: 'Nope' } });
  expect(res.status()).toBe(403);
  const get = await request.get(`/booking/${booking.id}`);
  expect(bookingSchema.parse(await get.json())).toEqual(booking.data);
});

// Regression: PUT without a token is accepted or modifies the booking anyway.
test('PUT without a token returns 403 and changes nothing', async ({ request, booking }) => {
  const res = await request.put(`/booking/${booking.id}`, {
    data: newBooking({ firstname: 'Intruder', totalprice: 1 }),
  });
  expect(res.status()).toBe(403);

  const get = await request.get(`/booking/${booking.id}`);
  expect(bookingSchema.parse(await get.json())).toEqual(booking.data);
});

// Regression: DELETE does not answer 201 or leaves the booking readable/listed.
test('DELETE answers 201 and the booking is gone', async ({ request, booking, token }) => {
  const res = await request.delete(`/booking/${booking.id}`, { headers: { Cookie: `token=${token}` } });
  expect(res.status()).toBe(201);

  expect((await request.get(`/booking/${booking.id}`)).status()).toBe(404);
  const list = await request.get('/booking', {
    params: { firstname: booking.data.firstname, lastname: booking.data.lastname },
  });
  expect(idListSchema.parse(await list.json())).toEqual([]);
});

// Regression: DELETE without a token removes the booking.
test('DELETE without a token is rejected and the booking remains', async ({ request, booking }) => {
  const res = await request.delete(`/booking/${booking.id}`);
  expect(res.status()).toBe(403);
  const get = await request.get(`/booking/${booking.id}`);
  expect(get.status()).toBe(200);
  expect(bookingSchema.parse(await get.json())).toEqual(booking.data);
});
