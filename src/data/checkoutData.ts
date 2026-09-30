export interface CheckoutInformation {
  firstName: string;
  lastName: string;
  postalCode: string;
}

/** Synthetic shipping data: the site accepts anything non-empty. */
export const validCheckoutInformation: CheckoutInformation = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  postalCode: '12345',
};
