import type { Page } from '@playwright/test';
import { env } from '../../config/env';
import type { SauceUser } from '../data/users';

/**
 * Starts an authenticated session without going through the login form.
 *
 * SauceDemo keeps the "session" in a plain `session-username` cookie, so setting it and opening
 * /inventory.html is equivalent to logging in (validated empirically, see README design notes).
 * The login form itself is covered by login.feature, which uses the real UI.
 * If the site ever stops honoring the cookie, only this function needs to fall back to the form.
 */
export async function loginViaSession(page: Page, username: SauceUser): Promise<void> {
  await page
    .context()
    .addCookies([{ name: 'session-username', value: username, url: env.sauce.baseUrl }]);
  await page.goto('/inventory.html');
}
