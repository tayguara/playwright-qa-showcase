# Known issues and sandbox quirks

Observed on 2026-09-30 against the live sandboxes. Both are shared public third-party sites that can change or be unavailable without notice, so treat this list as a dated snapshot, not a guarantee.

## SauceDemo (https://www.saucedemo.com)

### problem_user

`problem_user` is a deliberately broken account. All of the following were verified by hand. Only the first one is automated, by design: one representative failing test is enough to show the mechanism, and the others are documented here.

| Defect                                                                                                                                                                                                                   | Automated                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Every product shows the same placeholder image (`/assets/sl-404-*.jpg`) instead of its own picture                                                                                                                       | Yes, `features/known-issues.feature`, tagged `@fail` |
| Sorting has no effect: choosing "Name (Z to A)" or "Price (high to low)" keeps the original order                                                                                                                        | No                                                   |
| Add to cart and Remove work only for some products. For example "Sauce Labs Bolt T-Shirt" and "Sauce Labs Fleece Jacket" cannot be added, and "Remove" on "Sauce Labs Onesie" does nothing, leaving the cart badge wrong | No                                                   |
| On checkout step one, typing in "Last Name" overwrites "First Name", so "Last Name is required" is shown and checkout cannot continue                                                                                    | No                                                   |

The automated scenario asserts the correct behavior and is expected to fail. If the site is fixed it will be reported as "unexpectedly passed", and the `@fail` tag must then be removed. Limitation: `@fail` accepts any failure, so the scenario also "passes" when the site is down or a selector drifts. It relies on the other UI tests to show that the site is up.

### Other behavior the suite relies on

- `locked_out_user` cannot log in. This is intended and is covered as a normal scenario.
- The session is a plain cookie (`session-username=<user>`). That is not a secure session design, but it is why `loginViaSession` can skip the login form outside `login.feature`.
- With that cookie present, the login page (`/`) redirects to `/inventory.html`, so the login page must be scanned for accessibility before the cookie is set.
- The cart lives in `localStorage` (`cart-contents`), per browser context, which keeps tests isolated.
- The menu items (Logout, All Items, ...) are anchors with `role="button"`, and the page objects rely on that.
- The suite relies on `data-test` attributes. A newer "Dynamic Catalog" menu entry exists and is not covered.

### Accessibility findings (axe-core 4.13.0, scanned 2026-09)

Pages scanned: login, inventory, cart, checkout step one.

- WCAG 2.0, 2.1 and 2.2 A and AA rules: no violations on any of the four pages.
- Best-practice rules (advisory, not WCAG failures), recorded in `src/a11y/a11y-baseline.json`:

| Page              | Rule                   | Impact   | Finding                                          |
| ----------------- | ---------------------- | -------- | ------------------------------------------------ |
| login             | `page-has-heading-one` | moderate | No level-one heading; the logo is a plain `div`  |
| login             | `region`               | moderate | The logo text sits outside any landmark          |
| inventory         | `page-has-heading-one` | moderate | No level-one heading; "Products" is a `span`     |
| cart              | `page-has-heading-one` | moderate | No level-one heading; "Your Cart" is a `span`    |
| checkout-step-one | `page-has-heading-one` | moderate | No level-one heading; the page title is a `span` |

- Needs manual review: the inventory page has three `color-contrast` checks that axe reports as "incomplete" (the sort control, its active option and one product description). axe could not determine the background color because of a pseudo-element or overlap, so these are neither passes nor violations until someone checks them.

Automated checks cover only a portion of WCAG and do not replace a manual audit with assistive technology.

## Restful Booker (https://restful-booker.herokuapp.com)

The API is a shared sandbox: anyone can create, change or delete bookings, and the data can be reset. The suite only touches bookings it created itself (unique last name `Showcase-<random>`) and deletes them in teardown. The quirks below were probed before being asserted, and the tests pin them (annotated `api-quirk` where relevant).

| Area                                                       | Observed behavior                                  | Conventional expectation          |
| ---------------------------------------------------------- | -------------------------------------------------- | --------------------------------- |
| `POST /auth` with bad or empty credentials                 | HTTP 200 with body `{"reason":"Bad credentials"}`  | 401                               |
| `POST /booking`                                            | HTTP 200 with `{bookingid, booking}`               | 201                               |
| `POST /booking` with an invalid body                       | HTTP 500, `text/plain` "Internal Server Error"     | 400 or 422                        |
| `DELETE /booking/:id` success                              | HTTP 201, `text/plain` "Created"                   | 204 or 200                        |
| `DELETE` or `PUT` on a missing or already deleted id       | HTTP 405                                           | 404                               |
| `GET /booking/:id` unknown or deleted id                   | HTTP 404, `text/plain` "Not Found"                 | As expected                       |
| `PUT`, `PATCH`, `DELETE` without a token or with a bad one | HTTP 403, `text/plain` "Forbidden"                 | As expected                       |
| `GET /booking?firstname=&lastname=`                        | Exact match only; a partial last name returns `[]` | Partial or case-insensitive match |
| Error bodies                                               | `text/plain`, not JSON                             | JSON error objects                |
| `Accept: text/html` or an empty `Accept` header            | HTTP 418 "I'm a Teapot"                            | 406                               |

Notes:

- `418` is not triggered by a missing `Accept` header with the default `Accept: */*` of curl or Playwright. It appears for `text/html` and for an empty value. The suite sends `Accept: application/json` on every request anyway (set in `playwright.config.ts`).
- A `POST /booking` that answers 418 still stores the booking. This was verified and cleaned up, and there is no test for it.
- `PUT` returns the full replacement and `PATCH` returns the merged booking, both as a bare booking object (not wrapped).
- Because of the 405 on repeated deletes, the `booking` fixture teardown accepts 201, 404 and 405.
- Latency from the machine used for development was around 0.5 s per request, with no cold start, 5xx or connection reset seen in six runs. The API project has a 60 s timeout to absorb a Heroku cold start, and each worker's first request (the token fixture) doubles as a warm-up.
- Tokens are 15 hex characters and expire on the server after some time, so each worker logs in once.
