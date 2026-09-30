import { expect } from '@playwright/test';
import { env } from '../../config/env';
import { toSauceUser } from '../../src/data/users';
import { Given, Then, When } from '../../src/fixtures/ui.fixtures';

function passwordFor(kind: string): string {
  switch (kind) {
    case 'valid':
      return env.sauce.password;
    case 'wrong':
      return 'definitely-not-the-password';
    case 'empty':
      return '';
    default:
      throw new Error(`Unknown password kind "${kind}". Use valid, wrong or empty.`);
  }
}

Given('I am on the login page', async ({ loginPage }) => {
  await loginPage.goto();
  await expect(loginPage.loginButton).toBeVisible();
});

Given(
  'I am logged in as {string} using the login form',
  async ({ loginPage, inventoryPage }, username: string) => {
    await loginPage.goto();
    await loginPage.login(toSauceUser(username), env.sauce.password);
    await expect(inventoryPage.title).toHaveText('Products');
  },
);

When('I log in as {string} with the valid password', async ({ loginPage }, username: string) => {
  await loginPage.login(toSauceUser(username), env.sauce.password);
});

When(
  'I log in with username {string} and a {word} password',
  async ({ loginPage }, username: string, passwordKind: string) => {
    await loginPage.login(username, passwordFor(passwordKind));
  },
);

When('I log out', async ({ header }) => {
  await header.logout();
});

When('I open the inventory page directly', async ({ inventoryPage }) => {
  await inventoryPage.goto();
});

Then('I see the login error {string}', async ({ loginPage }, message: string) => {
  await expect(loginPage.errorMessage).toHaveText(message);
});

Then('I am still on the login page', async ({ page, loginPage }) => {
  await expect(page).toHaveURL('/');
  await expect(loginPage.loginButton).toBeVisible();
});

Then('I am back on the login page', async ({ page, loginPage }) => {
  await expect(page).toHaveURL('/');
  await expect(loginPage.loginButton).toBeVisible();
});
