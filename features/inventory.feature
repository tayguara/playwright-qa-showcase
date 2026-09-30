@ui @inventory
Feature: Inventory
  As a shopper I can browse the catalog, sort it and collect products in my cart.

  Background:
    Given I am logged in as "standard_user"

  Scenario Outline: Products can be sorted by <option>
    When I sort the products by "<option>"
    Then the products are listed by <field> in <direction> order

    # "Name (A to Z)" is not an example on purpose: it is the default order, so it would pass
    # even if the sort control did nothing.
    Examples:
      | option              | field | direction  |
      | Name (Z to A)       | name  | descending |
      | Price (low to high) | price | ascending  |
      | Price (high to low) | price | descending |

  Scenario: The cart badge follows the products added and removed
    When I add "Sauce Labs Backpack" to the cart
    And I add "Sauce Labs Onesie" to the cart
    Then the cart badge shows 2
    When I remove "Sauce Labs Onesie" from the cart
    Then the cart badge shows 1
    When I remove "Sauce Labs Backpack" from the cart
    Then the cart badge is not shown
