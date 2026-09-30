import type { Locator, Page } from '@playwright/test';

export class CartPage {
  readonly items: Locator;
  readonly productNames: Locator;
  private readonly checkoutButton: Locator;

  constructor(page: Page) {
    this.items = page.getByTestId('inventory-item');
    this.productNames = this.items.getByTestId('inventory-item-name');
    this.checkoutButton = page.getByRole('button', { name: 'Checkout' });
  }

  async startCheckout(): Promise<void> {
    await this.checkoutButton.click();
  }
}
