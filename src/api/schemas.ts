import * as z from 'zod';

/** Dates are plain calendar dates (YYYY-MM-DD). */
const isoDate = z.iso.date();

export const bookingDatesSchema = z.object({
  checkin: isoDate,
  checkout: isoDate,
});

/** The booking resource as sent in requests and returned by GET /booking/:id. */
export const bookingSchema = z.object({
  firstname: z.string(),
  lastname: z.string(),
  totalprice: z.number(),
  depositpaid: z.boolean(),
  bookingdates: bookingDatesSchema,
  additionalneeds: z.string().optional(),
});

/** POST /booking response: the server wraps the stored booking with its generated id. */
export const createdBookingSchema = z.object({
  bookingid: z.number().int().positive(),
  booking: bookingSchema,
});

/** GET /booking?firstname=&lastname= response: ids only. */
export const bookingSearchSchema = z.array(z.object({ bookingid: z.number().int().positive() }));

/** POST /auth success response. */
export const authSuccessSchema = z.object({ token: z.string().min(1) });

/** POST /auth failure response. The API answers HTTP 200 for bad credentials (documented quirk). */
export const authFailureSchema = z.object({ reason: z.literal('Bad credentials') });

export type Booking = z.infer<typeof bookingSchema>;
