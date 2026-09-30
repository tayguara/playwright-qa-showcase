import type { Locator, Page } from '@playwright/test';
import { parsePrice } from '../support/money';

/** Checkout step two: "Overview". */
export class CheckoutOverviewPage {
  readonly items: Locator;
  readonly productNames: Locator;
  private readonly itemTotalLabel: Locator;
  private readonly taxLabel: Locator;
  private readonly totalLabel: Locator;
  private readonly finishButton: Locator;
  private readonly cancelButton: Locator;

  constructor(page: Page) {
    this.items = page.getByTestId('inventory-item');
    this.productNames = this.items.getByTestId('inventory-item-name');
    this.itemTotalLabel = page.getByTestId('subtotal-label');
    this.taxLabel = page.getByTestId('tax-label');
    this.totalLabel = page.getByTestId('total-label');
    this.finishButton = page.getByRole('button', { name: 'Finish' });
    this.cancelButton = page.getByRole('button', { name: 'Cancel' });
  }

  async itemPrices(): Promise<number[]> {
    // allTextContents() does not wait, so wait for the rows first.
    await this.items.first().waitFor();
    const texts = await this.items.getByTestId('inventory-item-price').allTextContents();
    return texts.map(parsePrice);
  }

  async itemTotal(): Promise<number> {
    return parsePrice(await this.itemTotalLabel.innerText());
  }

  async tax(): Promise<number> {
    return parsePrice(await this.taxLabel.innerText());
  }

  async total(): Promise<number> {
    return parsePrice(await this.totalLabel.innerText());
  }

  async finish(): Promise<void> {
    await this.finishButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }
}
