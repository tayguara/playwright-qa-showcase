import { expect } from '@playwright/test';
import { loginViaSession } from '../../src/support/auth';
import { toSauceUser } from '../../src/data/users';
import { Given, Then, When } from '../../src/fixtures/ui.fixtures';

Given('I am logged in as {string}', async ({ page, inventoryPage }, username: string) => {
  await loginViaSession(page, toSauceUser(username));
  await expect(inventoryPage.title).toHaveText('Products');
});

Then('I see the products page', async ({ page, inventoryPage }) => {
  await expect(page).toHaveURL(/\/inventory\.html$/);
  await expect(inventoryPage.title).toHaveText('Products');
});

When('I add {string} to the cart', async ({ inventoryPage, scenario }, productName: string) => {
  await inventoryPage.addToCart(productName);
  scenario.cartProducts.push(productName);
});

When(
  'I remove {string} from the cart',
  async ({ inventoryPage, scenario }, productName: string) => {
    await inventoryPage.removeFromCart(productName);
    scenario.cartProducts = scenario.cartProducts.filter((name) => name !== productName);
  },
);

When('I open the cart', async ({ page, header }) => {
  await header.openCart();
  await expect(page).toHaveURL(/\/cart\.html$/);
});

Then('the cart badge shows {int}', async ({ header }, count: number) => {
  await expect(header.cartBadge).toHaveText(String(count));
});

Then('the cart badge is not shown', async ({ header }) => {
  await expect(header.cartBadge).toHaveCount(0);
});
