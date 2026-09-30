import { expect } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { validCheckoutInformation } from '../../src/data/checkoutData';
import { Given, Then, When } from '../../src/fixtures/ui.fixtures';
import { sumCents, toCents } from '../../src/support/money';

Given(
  'the cart contains the following products:',
  async ({ inventoryPage, header, scenario }, products: DataTable) => {
    for (const row of products.hashes()) {
      const product = row.product;
      if (!product) {
        throw new Error('The products table needs a "product" column with a value in every row');
      }
      await inventoryPage.addToCart(product);
      scenario.cartProducts.push(product);
    }
    await expect(header.cartBadge).toHaveText(String(scenario.cartProducts.length));
  },
);

When('I start the checkout', async ({ page, cartPage }) => {
  await cartPage.startCheckout();
  await expect(page).toHaveURL(/\/checkout-step-one\.html$/);
});

When('I submit valid shipping information', async ({ page, checkoutInformationPage }) => {
  await checkoutInformationPage.fillAndContinue(validCheckoutInformation);
  await expect(page).toHaveURL(/\/checkout-step-two\.html$/);
});

When(
  'I submit the shipping form with first name {string}, last name {string} and postal code {string}',
  async ({ checkoutInformationPage }, firstName: string, lastName: string, postalCode: string) => {
    await checkoutInformationPage.fillAndContinue({ firstName, lastName, postalCode });
  },
);

When('I finish the order', async ({ checkoutOverviewPage }) => {
  await checkoutOverviewPage.finish();
});

When('I cancel the order from the overview', async ({ checkoutOverviewPage }) => {
  await checkoutOverviewPage.cancel();
});

Then('the order overview lists the same products', async ({ checkoutOverviewPage, scenario }) => {
  await expect(checkoutOverviewPage.productNames).toHaveText(scenario.cartProducts);
});

Then('the item total equals the sum of the item prices', async ({ checkoutOverviewPage }) => {
  const prices = await checkoutOverviewPage.itemPrices();

  expect(toCents(await checkoutOverviewPage.itemTotal())).toBe(sumCents(prices));
});

Then('the order total equals the item total plus tax', async ({ checkoutOverviewPage }) => {
  const itemTotal = await checkoutOverviewPage.itemTotal();
  const tax = await checkoutOverviewPage.tax();

  expect(toCents(await checkoutOverviewPage.total())).toBe(sumCents([itemTotal, tax]));
});

Then('I see the order confirmation {string}', async ({ checkoutCompletePage }, message: string) => {
  await expect(checkoutCompletePage.confirmation).toHaveText(message);
});

Then('I see the checkout error {string}', async ({ checkoutInformationPage }, message: string) => {
  await expect(checkoutInformationPage.errorMessage).toHaveText(message);
});

Then('I am still on the shipping information step', async ({ page }) => {
  await expect(page).toHaveURL(/\/checkout-step-one\.html$/);
});

Then('the cart lists {string}', async ({ cartPage }, productName: string) => {
  await expect(cartPage.productNames).toHaveText([productName]);
});
