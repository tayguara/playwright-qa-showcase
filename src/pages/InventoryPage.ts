import type { Locator, Page } from '@playwright/test';
import { parsePrice } from '../support/money';
import { HeaderComponent } from './components/HeaderComponent';

export class InventoryPage {
  readonly header: HeaderComponent;
  readonly title: Locator;
  readonly items: Locator;
  private readonly sortSelect: Locator;

  constructor(private readonly page: Page) {
    this.header = new HeaderComponent(page);
    this.title = page.getByTestId('title');
    this.items = page.getByTestId('inventory-item');
    this.sortSelect = page.getByRole('combobox', { name: 'Sort products' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/inventory.html');
  }

  async sortBy(optionLabel: string): Promise<void> {
    await this.sortSelect.selectOption({ label: optionLabel });
  }

  async productNames(): Promise<string[]> {
    return this.page.getByTestId('inventory-item-name').allTextContents();
  }

  async productPrices(): Promise<number[]> {
    const texts = await this.page.getByTestId('inventory-item-price').allTextContents();
    return texts.map(parsePrice);
  }

  async productImageSources(): Promise<string[]> {
    const sources = await this.items
      .getByRole('img')
      .evaluateAll((images) => images.map((image) => image.getAttribute('src') ?? ''));
    return sources;
  }

  async addToCart(productName: string): Promise<void> {
    await this.itemCard(productName).getByRole('button', { name: 'Add to cart' }).click();
  }

  async removeFromCart(productName: string): Promise<void> {
    await this.itemCard(productName).getByRole('button', { name: 'Remove' }).click();
  }

  private itemCard(productName: string): Locator {
    return this.items.filter({
      has: this.page.getByTestId('inventory-item-name').getByText(productName, { exact: true }),
    });
  }
}
