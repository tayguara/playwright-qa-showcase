import type { Locator, Page } from '@playwright/test';

/** The app header shared by every page after login: burger menu and cart. */
export class HeaderComponent {
  readonly cartLink: Locator;
  readonly cartBadge: Locator;
  private readonly openMenuButton: Locator;
  private readonly logoutLink: Locator;

  constructor(page: Page) {
    this.cartLink = page.getByTestId('shopping-cart-link');
    this.cartBadge = page.getByTestId('shopping-cart-badge');
    this.openMenuButton = page.getByRole('button', { name: 'Open Menu' });
    this.logoutLink = page.getByRole('button', { name: 'Logout' });
  }

  async openCart(): Promise<void> {
    await this.cartLink.click();
  }

  async logout(): Promise<void> {
    await this.openMenuButton.click();
    await this.logoutLink.click();
  }
}
