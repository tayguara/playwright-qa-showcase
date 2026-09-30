import { expect } from '@playwright/test';
import { Then, When } from '../../src/fixtures/ui.fixtures';

type Direction = 'ascending' | 'descending';

/** The order the listing must have: a JS sort of the very values the page shows. */
function expectedOrder<T>(
  values: readonly T[],
  direction: Direction,
  compare: (a: T, b: T) => number,
) {
  const ascending = [...values].sort(compare);
  return direction === 'ascending' ? ascending : ascending.reverse();
}

function parseDirection(value: string): Direction {
  if (value === 'ascending' || value === 'descending') {
    return value;
  }
  throw new Error(`Unknown direction "${value}". Use ascending or descending.`);
}

When('I sort the products by {string}', async ({ inventoryPage }, optionLabel: string) => {
  await inventoryPage.sortBy(optionLabel);
});

Then(
  'the products are listed by {word} in {word} order',
  async ({ inventoryPage }, field: string, directionText: string) => {
    const direction = parseDirection(directionText);

    // The list re-renders after the selection, so retry until the DOM reflects the new order.
    // toPass defaults to a timeout of 0 and ignores expect.timeout, so the bound is explicit.
    await expect(async () => {
      if (field === 'name') {
        const names = await inventoryPage.productNames();
        expect(names).toEqual(
          expectedOrder(names, direction, (a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        );
      } else if (field === 'price') {
        const prices = await inventoryPage.productPrices();
        expect(prices).toEqual(expectedOrder(prices, direction, (a, b) => a - b));
      } else {
        throw new Error(`Unknown sort field "${field}". Use name or price.`);
      }
    }).toPass({ timeout: 5_000 });
  },
);

Then('every product shows its own image', async ({ inventoryPage }) => {
  await expect(inventoryPage.items.first()).toBeVisible();
  const sources = await inventoryPage.productImageSources();

  expect(new Set(sources).size, 'each product should have a distinct image').toBe(sources.length);
});
