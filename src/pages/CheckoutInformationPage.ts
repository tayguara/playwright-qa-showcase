import type { Locator, Page } from '@playwright/test';
import type { CheckoutInformation } from '../data/checkoutData';

/** Checkout step one: "Your Information". */
export class CheckoutInformationPage {
  readonly errorMessage: Locator;
  readonly firstNameInput: Locator;
  private readonly lastNameInput: Locator;
  private readonly postalCodeInput: Locator;
  private readonly continueButton: Locator;

  constructor(page: Page) {
    this.firstNameInput = page.getByTestId('firstName');
    this.lastNameInput = page.getByTestId('lastName');
    this.postalCodeInput = page.getByTestId('postalCode');
    this.continueButton = page.getByRole('button', { name: 'Continue' });
    this.errorMessage = page.getByTestId('error');
  }

  async fillAndContinue(information: CheckoutInformation): Promise<void> {
    await this.firstNameInput.fill(information.firstName);
    await this.lastNameInput.fill(information.lastName);
    await this.postalCodeInput.fill(information.postalCode);
    await this.continueButton.click();
  }
}
