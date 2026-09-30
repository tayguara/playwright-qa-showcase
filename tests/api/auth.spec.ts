import { env } from '../../config/env';
import { authFailureSchema, authSuccessSchema } from '../../src/api/schemas';
import { expect, test } from '../../src/fixtures/api.fixtures';

test.describe('POST /auth', { tag: '@api' }, () => {
  test('A1: valid credentials return a token', async ({ bookingClient }) => {
    const response = await bookingClient.auth(env.booker.username, env.booker.password);

    expect(response.status()).toBe(200);
    authSuccessSchema.parse(await response.json());
  });

  test('A2: invalid credentials answer HTTP 200 with a reason instead of a 4xx', async ({
    bookingClient,
  }) => {
    test.info().annotations.push({
      type: 'api-quirk',
      description:
        'POST /auth answers HTTP 200 (not 401) for bad credentials; the failure is only in the body.',
    });

    const response = await bookingClient.auth(env.booker.username, 'definitely-not-the-password');

    expect(response.status()).toBe(200);
    expect(authFailureSchema.parse(await response.json())).toEqual({ reason: 'Bad credentials' });
  });
});
