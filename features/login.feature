@ui @login
Feature: Login
  As a shopper I can sign in to the store and I am told clearly when I cannot.

  @smoke
  Scenario: A standard user logs in successfully
    Given I am on the login page
    When I log in as "standard_user" with the valid password
    Then I see the products page

  Scenario Outline: Invalid credentials are rejected: <case>
    Given I am on the login page
    When I log in with username "<username>" and a <password_kind> password
    Then I see the login error "<error>"

    Examples:
      | case           | username      | password_kind | error                                                                     |
      | empty username |               | valid         | Epic sadface: Username is required                                        |
      | empty password | standard_user | empty         | Epic sadface: Password is required                                        |
      | wrong password | standard_user | wrong         | Epic sadface: Username and password do not match any user in this service |

  Scenario: A locked out user cannot log in
    Given I am on the login page
    When I log in as "locked_out_user" with the valid password
    Then I see the login error "Epic sadface: Sorry, this user has been locked out."
    And I am still on the login page

  Scenario: Logging out ends the session
    Given I am logged in as "standard_user" using the login form
    When I log out
    Then I am back on the login page
    When I open the inventory page directly
    Then I see the login error "Epic sadface: You can only access '/inventory.html' when you are logged in."
