import { CartPage } from '../../src/pages/CartPage';
import { CheckoutInformationPage } from '../../src/pages/CheckoutInformationPage';
import { InventoryPage } from '../../src/pages/InventoryPage';
import { LoginPage } from '../../src/pages/LoginPage';
import { expect, test } from '../../src/fixtures/a11y.fixtures';
import { loginViaSession } from '../../src/support/auth';

test.describe('SauceDemo accessibility (axe-core)', { tag: '@a11y' }, () => {
  test('login page has no new violations', async ({ page, auditPage }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await expect(loginPage.loginButton).toBeVisible();

    await auditPage('login');
  });

  test('inventory page has no new violations', async ({ page, auditPage }) => {
    await loginViaSession(page, 'standard_user');
    await expect(new InventoryPage(page).items.first()).toBeVisible();

    await auditPage('inventory');
  });

  test('cart page with one item has no new violations', async ({ page, auditPage }) => {
    await loginViaSession(page, 'standard_user');
    const inventoryPage = new InventoryPage(page);
    await inventoryPage.addToCart('Sauce Labs Backpack');
    await inventoryPage.header.openCart();
    await expect(new CartPage(page).items).toHaveCount(1);

    await auditPage('cart');
  });

  test('checkout step one has no new violations', async ({ page, auditPage }) => {
    await loginViaSession(page, 'standard_user');
    const inventoryPage = new InventoryPage(page);
    await inventoryPage.addToCart('Sauce Labs Backpack');
    await inventoryPage.header.openCart();
    await new CartPage(page).startCheckout();
    await expect(page).toHaveURL(/\/checkout-step-one\.html$/);
    await expect(new CheckoutInformationPage(page).firstNameInput).toBeVisible();

    await auditPage('checkout-step-one');
  });
});
