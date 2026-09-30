import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { Booking } from './schemas';

/**
 * Thin typed wrapper over the restful-booker endpoints.
 *
 * Every method returns the raw `APIResponse` so tests decide what to assert (status, headers,
 * body). Parsing and contract validation live in the tests through the zod schemas.
 *
 * Retries: `maxRetries` only repeats a request after a network-level error (ECONNRESET), which
 * the shared Heroku sandbox produces occasionally. It never retries on an HTTP status, so a
 * genuine 4xx/5xx still fails the test.
 */
export class BookingClient {
  private static readonly maxRetries = 2;

  constructor(private readonly request: APIRequestContext) {}

  /** POST /auth. Bad credentials still answer HTTP 200 (see the `api-quirk` annotations). */
  auth(username: string, password: string): Promise<APIResponse> {
    return this.request.post('/auth', {
      data: { username, password },
      maxRetries: BookingClient.maxRetries,
    });
  }

  /** POST /booking. */
  create(booking: Booking): Promise<APIResponse> {
    return this.request.post('/booking', {
      data: booking,
      maxRetries: BookingClient.maxRetries,
    });
  }

  /** GET /booking/:id. */
  get(id: number): Promise<APIResponse> {
    return this.request.get(`/booking/${id}`, { maxRetries: BookingClient.maxRetries });
  }

  /** GET /booking?firstname=&lastname=. Returns `[{ bookingid }]`. */
  findByName(firstname: string, lastname: string): Promise<APIResponse> {
    return this.request.get('/booking', {
      params: { firstname, lastname },
      maxRetries: BookingClient.maxRetries,
    });
  }

  /** PUT /booking/:id, a full replacement. Pass no token to exercise the unauthorized path. */
  update(id: number, booking: Booking, token?: string): Promise<APIResponse> {
    return this.request.put(`/booking/${id}`, {
      data: booking,
      headers: this.authHeaders(token),
      maxRetries: BookingClient.maxRetries,
    });
  }

  /** PATCH /booking/:id, a partial update. */
  patch(id: number, changes: Partial<Booking>, token?: string): Promise<APIResponse> {
    return this.request.patch(`/booking/${id}`, {
      data: changes,
      headers: this.authHeaders(token),
      maxRetries: BookingClient.maxRetries,
    });
  }

  /** DELETE /booking/:id. Answers 201 on success (see the `api-quirk` annotations). */
  delete(id: number, token?: string): Promise<APIResponse> {
    return this.request.delete(`/booking/${id}`, {
      headers: this.authHeaders(token),
      maxRetries: BookingClient.maxRetries,
    });
  }

  /** The API reads the token from a `token` cookie, not from an Authorization header. */
  private authHeaders(token?: string): Record<string, string> {
    return token ? { Cookie: `token=${token}` } : {};
  }
}
