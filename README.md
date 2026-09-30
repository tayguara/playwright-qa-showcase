# playwright-qa-showcase

A compact, production-style test automation project: Playwright and TypeScript with BDD for UI flows, typed API tests, accessibility checks and sharded CI.

[![Playwright](https://github.com/tayguara/playwright-qa-showcase/actions/workflows/playwright.yml/badge.svg?branch=main&event=push)](https://github.com/tayguara/playwright-qa-showcase/actions/workflows/playwright.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## What this is and why

I built this repository to show how I structure test automation when I lead QA on a project: what gets tested at which layer, how the code is organized so that it stays maintainable, and how the pipeline gives a fast, trustworthy signal.

It targets two public sandboxes, so anyone can clone it and run it in a minute with no accounts or secrets:

- [SauceDemo](https://www.saucedemo.com), an e-commerce demo (UI).
- [Restful Booker](https://restful-booker.herokuapp.com), a hotel booking REST API.

It is small on purpose. Every file is there for a reason that is explained in [Design decisions](#design-decisions).

## At a glance

| Suite  | Target              | Tests | Approach                                                                                             |
| ------ | ------------------- | ----: | ---------------------------------------------------------------------------------------------------- |
| `ui`   | SauceDemo           |    16 | Gherkin scenarios (10, some are outlines) run through `playwright-bdd`, page objects, fixtures       |
| `api`  | Restful Booker      |     8 | Plain Playwright tests, typed client, zod response contracts                                         |
| `a11y` | SauceDemo (4 pages) |     4 | axe-core scans of WCAG 2.0/2.1/2.2 A and AA rules plus best-practice rules, with a reviewed baseline |
| `unit` | Test-support code   |    28 | Plain Playwright tests for the pure helpers (money math, a11y baseline diff, booking builder)        |

That is 56 tests in total. One of the UI scenarios is a tracked known defect and is expected to fail (see [known defects](#known-defects-are-tracked-not-skipped)). Counts come from `npx playwright test --list` and will drift as the suite grows.

## Tech stack

Versions are the ones in use at the time of writing; `package.json` and the lockfile are the source of truth.

| Tool                                                              | Version                 | Used for                                                          |
| ----------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| Node.js                                                           | 22 (`.nvmrc`)           | Runtime                                                           |
| [@playwright/test](https://playwright.dev)                        | 1.63.0                  | Test runner, browser and API testing                              |
| [playwright-bdd](https://github.com/vitalets/playwright-bdd)      | 9.2.1                   | Runs Gherkin `.feature` files on the Playwright runner            |
| [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm) | 4.13.0                  | Automated accessibility checks                                    |
| [zod](https://zod.dev)                                            | 4.6.5                   | Runtime validation of API contracts and of the a11y baseline file |
| TypeScript                                                        | 6.0.3                   | `strict` and `noUncheckedIndexedAccess`                           |
| ESLint, typescript-eslint, eslint-plugin-playwright               | 10.11.0, 8.71.0, 2.12.0 | Type-aware linting with Playwright rules                          |
| Prettier                                                          | 3.9.9                   | Formatting                                                        |

TypeScript is pinned below 7 because `typescript-eslint` does not support it yet.

## Getting started

Requirements: Node.js 22 (`nvm use` reads `.nvmrc`) and an internet connection, because the targets are public sites.

```bash
npm ci
npx playwright install chromium   # on Linux CI use --with-deps
npm test
npm run report                    # opens the HTML report
```

| Script                                                     | What it does                                          |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `npm test`                                                 | Generates the BDD specs and runs every project        |
| `npm run test:ui` / `test:api` / `test:a11y` / `test:unit` | Runs a single project                                 |
| `npm run test:smoke`                                       | Runs the UI scenarios tagged `@smoke`                 |
| `npm run report`                                           | Opens the last HTML report                            |
| `npm run lint`                                             | ESLint, zero warnings allowed                         |
| `npm run typecheck`                                        | `tsc --noEmit`                                        |
| `npm run format` / `format:check`                          | Prettier write / check                                |
| `npm run check`                                            | lint, typecheck and format check (what CI runs first) |

The test scripts run `bddgen` first, which turns the `.feature` files into Playwright specs in `.features-gen/` (git-ignored). If you call `npx playwright test` directly, run `npx bddgen` before it.

### Configuration

Every variable is optional. Copy `.env.example` to `.env` to override the defaults.

| Variable          | Default                                | Purpose                                     |
| ----------------- | -------------------------------------- | ------------------------------------------- |
| `SAUCE_BASE_URL`  | `https://www.saucedemo.com`            | UI target                                   |
| `SAUCE_PASSWORD`  | `secret_sauce`                         | Password shared by all SauceDemo demo users |
| `BOOKER_BASE_URL` | `https://restful-booker.herokuapp.com` | API target                                  |
| `BOOKER_USERNAME` | `admin`                                | Restful Booker admin user                   |
| `BOOKER_PASSWORD` | `password123`                          | Restful Booker admin password               |

The defaults are the public demo credentials published by the sandbox sites themselves, so they are not secrets. In a real project these values come from CI secrets (or a vault) and are never committed. `config/env.ts` is the single place that reads them, and variables already present in the environment win over `.env`.

## Project structure

```text
features/                 Gherkin scenarios (UI business flows only)
  steps/                  Step definitions, one file per area
src/
  pages/                  Page objects (+ components/HeaderComponent)
  fixtures/               ui, api and a11y fixtures
  api/                    BookingClient and zod schemas
  a11y/                   axe runner, baseline logic, a11y-baseline.json
  data/                   Test data builders and demo users
  support/                Login shortcut, money helpers
tests/
  api/  a11y/  unit/      Plain Playwright specs
config/env.ts             Typed configuration with public defaults
docs/KNOWN_ISSUES.md      Sandbox defects and quirks, dated
.github/workflows/        CI pipeline
```

## Design decisions

### BDD only where it pays off

Gherkin is used for the UI business flows (login, inventory, checkout), where a readable scenario is useful to non-engineers and the steps are reusable. API tests and accessibility checks are plain Playwright tests: their value is in the assertions on status codes, payloads and rule ids, and wrapping those in Given/When/Then would add a translation layer without adding clarity. Gherkin tags (`@smoke`, `@login`, `@fail`, ...) are native Playwright tags, so `--grep @smoke` works as usual.

### Page objects and fixtures

Page objects own the locators and the actions of one page. In the BDD steps they are handed over through Playwright fixtures, so steps never construct them and share no state: each test gets its own browser context. The four plain a11y specs construct the few page objects they need directly, which is the simplest thing that works for four short tests. Locators prefer role and `data-test` attributes over CSS, and assertions are web-first (auto-retrying) instead of hard waits.

### Login strategy

UI login happens only where login is under test (`login.feature`). Everywhere else the suite starts an authenticated session through `loginViaSession`, which sets the `session-username` cookie SauceDemo uses as its session and opens the inventory page. This was validated against the live site, and it removes the login form as a failure point from every other test. If the site stops honoring the cookie, only that one function has to change.

### Typed API client and contracts

`BookingClient` wraps the endpoints and returns the raw `APIResponse`, so tests still assert on status and headers. Response bodies are parsed with zod schemas, which turns a shape change in the API into a clear failure. Tests that depend on the auth token use a worker-scoped fixture, so each worker logs in once.

### Test data ownership and tolerant cleanup

The booking API is a shared sandbox that anyone can write to. Every API test therefore creates its own booking with a unique last name (`Showcase-<random>`), never touches data it did not create, and deletes it in teardown. Teardown accepts 201, 404 and 405 from `DELETE`, because the API answers those for "deleted" and "already gone" cases (see the quirks list), and other people's traffic must not make cleanup fail a test.

### Known defects are tracked, not skipped

SauceDemo's `problem_user` is broken on purpose. One defect is automated in `features/known-issues.feature` as a scenario that asserts the correct behavior and is tagged `@fail`. It is reported as an expected failure today. If the site is fixed, Playwright reports it as "unexpectedly passed", which is the signal to remove the tag. The tag is a coarse tracker: the scenario passes (as an expected failure) on any failure, including the site being down, so it relies on the other UI tests to show that the site is up. Nothing is skipped: lint rejects `test.skip` and friends in TypeScript, and the `quality` CI job fails if a feature file carries `@skip`, `@fixme` or `@only`, so a disabled test cannot hide in the suite. The other defects are documented in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

### Accessibility baseline

The `a11y` project scans four pages (login, inventory, cart, checkout step one) with axe-core. It runs the WCAG 2.0, 2.1 and 2.2 level A and AA rules, plus axe's `best-practice` rules. Best-practice rules are advisory guidance, not WCAG failures.

What the suite finds today:

- No WCAG A or AA violations on the four pages.
- Five best-practice findings, recorded in `src/a11y/a11y-baseline.json` with a reason and a date: `page-has-heading-one` on all four pages (no level-one heading) and `region` on the login page (content outside a landmark).
- Three `color-contrast` checks on the inventory page that axe could not decide automatically (axe reports them as "incomplete"). They need a manual look.

How the baseline works:

- A violation that is not in the baseline **fails the test**.
- A violation that is in the baseline passes and is annotated as known in the report.
- A baseline entry whose rule no longer fires is annotated as stale, so the file can be cleaned up.
- Changes to the baseline go through a pull request like any other code.

Two trade-offs are deliberate. The baseline is keyed by rule id per page, which keeps it small and readable but means a second element hitting an already-baselined rule is not flagged. Keying by element selector would catch it but is brittle against markup changes. And the tags can be narrowed to pure WCAG by editing one constant (`AXE_TAGS` in `src/a11y/axe.ts`).

Automated checks such as axe find only a portion of WCAG issues. They are good regression protection and do not replace a manual audit with assistive technology (screen reader, keyboard-only, zoom, and so on).

### CI, sharding and the merged report

The workflow in `.github/workflows/playwright.yml` has three jobs:

1. `quality` runs `npm run check`, `bddgen` (it fails on a Gherkin step with no definition), the pure-Node `unit` project and a guard that rejects `@skip`, `@fixme` and `@only` in feature files. It fails fast and cheap before any browser starts.
2. `test` runs after `quality`, as a matrix of two shards in parallel with `fail-fast: false`, so one failing shard does not hide the other. The shards cover the `ui`, `a11y` and `api` projects (14 tests each at the time of writing); the unit tests are not sharded because they need no browser. Each shard uploads a blob report.
3. `merge-reports` runs even when a shard failed (but not when `test` was skipped because `quality` failed), merges the blob reports into one HTML report, uploads it as an artifact (kept 14 days) and writes a short results table to the job summary.

To scale, raise the matrix in the workflow, for example `shardIndex: [1, 2, 3, 4]` with `shardTotal: [4]`. Nothing else changes, because the merge job collects `blob-report-*` artifacts by pattern. At this size, sharding demonstrates the pattern: a single job would finish sooner than two jobs that each install Chromium. It pays off when the suite grows.

Other CI choices: `permissions: contents: read`, no `pull_request_target`, a concurrency group that cancels superseded runs, dependency caching through `actions/setup-node`, the Node version read from `.nvmrc`, and Dependabot for npm and GitHub Actions updates.

It runs on pushes and pull requests to `main`, on manual dispatch, and nightly at 06:00 UTC (03:00 in Brasilia) to catch drift in the sandboxes. The badge at the top is filtered with `?branch=main&event=push`, so an outage of a public sandbox during a nightly run does not turn it red. GitHub disables scheduled workflows after 60 days without repository activity, so the nightly run may need to be re-enabled on a dormant repository.

### Flakiness policy

- Retries are enabled only in CI (2), never locally, so a flaky test is visible while you develop.
- Traces are recorded on the first retry in CI and kept for failures locally, where there are no retries. Screenshots are taken on failure.
- A test that passes only on retry is surfaced as flaky in the HTML report and in the job summary, and is investigated. The run itself stays green, so someone has to look at that counter.
- `forbidOnly` is on in CI.
- Lint bans hard waits (`waitForTimeout`), `force: true` clicks and skipped tests; CI also rejects disabled Gherkin scenarios.
- Each test owns its data and its browser context, so tests do not depend on order.

## Known issues and sandbox quirks

The targets are shared public sandboxes with intentional defects, so some behavior is odd by design (HTTP 200 for bad credentials, `DELETE` answering 201, and more). They are listed with the observed status codes in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md). Because the sites are third-party, they can also change or be down without notice.

## What I would do next in a real client project

- Run the suite against an environment the team controls, with data seeded through the API or database instead of shared sandboxes, and credentials from CI secrets.
- Add contract tests between services (for example consumer-driven contracts) next to these API tests.
- Run the smoke subset on every pull request and the full suite, across Firefox and WebKit as well, nightly.
- Publish the HTML report to a stable URL and comment the result on the pull request.
- Track flaky tests over time (retry rate per test) and feed it into the definition of done.
- Add visual regression for the critical screens and a basic performance budget for key pages.
- Pair the automated accessibility checks with a manual audit using assistive technology, and add a11y acceptance criteria to stories.
- Add pre-commit hooks and CODEOWNERS for the test code.

## License

[MIT](LICENSE)

## About the author

Tayguara Dias Reis, Lead QA / SDET. [github.com/tayguara](https://github.com/tayguara)
