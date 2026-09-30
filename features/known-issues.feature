@ui @known-issue
Feature: Known issues
  Defects of the SauceDemo sandbox that are tracked on purpose. See docs/KNOWN_ISSUES.md.
  These scenarios assert the CORRECT behavior and are marked @fail: today they fail (expected).
  If the site is ever fixed they "unexpectedly pass", which flags that the tag can be removed.

  @fail
  Scenario: problem_user sees a distinct image for each product
    Given I am logged in as "problem_user"
    Then every product shows its own image
