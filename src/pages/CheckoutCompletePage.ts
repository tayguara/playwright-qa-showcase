import type { Locator, Page } from '@playwright/test';

/** Order confirmation page. */
export class CheckoutCompletePage {
  readonly confirmation: Locator;

  constructor(page: Page) {
    this.confirmation = page.getByTestId('complete-header');
  }
}
