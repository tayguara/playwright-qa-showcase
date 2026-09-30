import { bookingSchema, bookingSearchSchema, createdBookingSchema } from '../../src/api/schemas';
import { buildBooking } from '../../src/data/bookingBuilder';
import { expect, test } from '../../src/fixtures/api.fixtures';

test.describe('/booking', { tag: '@api' }, () => {
  test('A3: creates a booking and reads back the same data', async ({
    bookingClient,
    authToken,
  }) => {
    const payload = buildBooking();
    const createResponse = await bookingClient.create(payload);
    expect(createResponse.status()).toBe(200);
    const created = createdBookingSchema.parse(await createResponse.json());

    try {
      expect(created.booking).toEqual(payload);

      const getResponse = await bookingClient.get(created.bookingid);

      expect(getResponse.status()).toBe(200);
      expect(bookingSchema.parse(await getResponse.json())).toEqual(payload);
    } finally {
      await bookingClient.delete(created.bookingid, authToken);
    }
  });

  test('A4: finds a booking by first and last name', async ({ bookingClient, booking }) => {
    const response = await bookingClient.findByName(
      booking.payload.firstname,
      booking.payload.lastname,
    );

    expect(response.status()).toBe(200);
    const ids = bookingSearchSchema.parse(await response.json()).map((entry) => entry.bookingid);
    expect(ids).toContain(booking.id);
  });

  test('A5: PUT replaces the whole booking', async ({ bookingClient, authToken, booking }) => {
    const replacement = buildBooking({
      firstname: 'Replaced',
      lastname: booking.payload.lastname,
      totalprice: 999,
      depositpaid: false,
      additionalneeds: 'Late checkout',
    });

    const putResponse = await bookingClient.update(booking.id, replacement, authToken);

    expect(putResponse.status()).toBe(200);
    expect(bookingSchema.parse(await putResponse.json())).toEqual(replacement);

    const getResponse = await bookingClient.get(booking.id);
    expect(bookingSchema.parse(await getResponse.json())).toEqual(replacement);
  });

  test('A6: PATCH changes only the given fields', async ({ bookingClient, authToken, booking }) => {
    const changes = { firstname: 'Patched', totalprice: 321 };

    const patchResponse = await bookingClient.patch(booking.id, changes, authToken);

    expect(patchResponse.status()).toBe(200);
    const expected = { ...booking.payload, ...changes };
    expect(bookingSchema.parse(await patchResponse.json())).toEqual(expected);

    const getResponse = await bookingClient.get(booking.id);
    expect(bookingSchema.parse(await getResponse.json())).toEqual(expected);
  });

  test('A7: PUT without a token is rejected with 403 and changes nothing', async ({
    bookingClient,
    booking,
  }) => {
    const response = await bookingClient.update(
      booking.id,
      buildBooking({ firstname: 'Intruder', lastname: booking.payload.lastname }),
    );

    expect(response.status()).toBe(403);

    const getResponse = await bookingClient.get(booking.id);
    expect(bookingSchema.parse(await getResponse.json())).toEqual(booking.payload);
  });

  test('A8: DELETE removes the booking (answers 201, not 204)', async ({
    bookingClient,
    authToken,
    booking,
  }) => {
    test.info().annotations.push({
      type: 'api-quirk',
      description:
        'DELETE /booking/:id answers 201 Created (not 200/204); a repeated DELETE answers 405.',
    });

    const deleteResponse = await bookingClient.delete(booking.id, authToken);

    expect(deleteResponse.status()).toBe(201);

    const getResponse = await bookingClient.get(booking.id);
    expect(getResponse.status()).toBe(404);
  });
});
