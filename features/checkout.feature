@ui @checkout
Feature: Checkout
  As a shopper I can pay for the products in my cart and the order totals add up.

  Background:
    Given I am logged in as "standard_user"

  @smoke
  Scenario: A shopper completes a purchase end to end
    Given the cart contains the following products:
      | product               |
      | Sauce Labs Backpack   |
      | Sauce Labs Bike Light |
    When I open the cart
    And I start the checkout
    And I submit valid shipping information
    Then the order overview lists the same products
    And the item total equals the sum of the item prices
    And the order total equals the item total plus tax
    When I finish the order
    Then I see the order confirmation "Thank you for your order!"
    And the cart badge is not shown

  Scenario Outline: Required shipping fields are validated: <case>
    Given I add "Sauce Labs Backpack" to the cart
    And I open the cart
    And I start the checkout
    When I submit the shipping form with first name "<first_name>", last name "<last_name>" and postal code "<postal_code>"
    Then I see the checkout error "<error>"
    And I am still on the shipping information step

    Examples:
      | case                | first_name | last_name | postal_code | error                          |
      | missing first name  |            | Lovelace  | 12345       | Error: First Name is required  |
      | missing last name   | Ada        |           | 12345       | Error: Last Name is required   |
      | missing postal code | Ada        | Lovelace  |             | Error: Postal Code is required |

  Scenario: Canceling at the overview keeps the cart
    Given I add "Sauce Labs Backpack" to the cart
    And I open the cart
    And I start the checkout
    And I submit valid shipping information
    When I cancel the order from the overview
    Then I see the products page
    And the cart badge shows 1
    When I open the cart
    Then the cart lists "Sauce Labs Backpack"
