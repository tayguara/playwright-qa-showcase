# Suite A: transcript summary

Written by hand from `suite-a.jsonl` and `suite-a.session.jsonl` (sanitised copies). Run: 2026-10-21T18:43:47Z to 18:44:19Z, model `claude-sonnet-5-5`, Claude Code 2.1.304, exit status 0, 3 turns, cost 0.0634 USD, prompt sha256 `ea96958e...` (equal to `prompts/agent-prompt.md`), no `CLAUDE.md` in the folder.

## Files created

- `playwright.config.ts`: `testDir ./tests`, 30 s timeout, `retries: 1`, list reporter, `baseURL` from `BOOKER_BASE_URL` with the public URL as default, and a default `Accept: application/json` header.
- `tests/booker.spec.ts`: one `describe` with 8 tests, a zod `bookingSchema`, helpers (`newBooking`, `getToken`, `createBooking`, `make`), a `beforeAll` that logs in once and an `afterAll` that deletes every booking created through `make`.

No ESLint configuration was added. Nothing was committed (the lab repository still has only the scaffold commit).

## Commands the agent ran

Two `Bash` calls and nothing else (no `Read`, `Write`, `Edit`, `Grep`, `WebFetch`):

1. `ls -a; cat package.json; cat playwright.config.* 2>/dev/null; ls tests 2>/dev/null` (looked at the scaffold).
2. One command that wrote both files with heredocs and ran `npx playwright test 2>&1 | tail -30`.

## Runs against the public API

One run: 8 tests, 8 passed, about 10 s (all requests went to the public sandbox, since `BOOKER_BASE_URL` was unset).

## Documentation

The agent did not read the API documentation: no `WebFetch`, no `curl`, no other command that fetches a page. Its choices (cookie token for write calls, 201 on delete, 403 without a token) came from its own knowledge of the API.

## Linting and type checking

Not run. `tsc` and ESLint were never invoked. ESLint and the plugin are installed in the scaffold, but no configuration was created.

## Problems it hit

None visible: the first and only test run passed.

## Final message against what holds

The final message says all 8 tests pass against the live sandbox, that all seven behaviours are covered, that each test creates its own booking and that leftovers are deleted afterwards, and that nothing was committed.

- All 8 passed in the run shown in the transcript, and the lab repository has no agent commit: both hold.
- The seven behaviours are each covered by at least one test (auth has two). "Each test creates its own booking" is true for the booking tests; the two auth tests create none.
- The message says nothing about lint or types, which were not checked. The tests were written and run once, and the PUT, PATCH, DELETE and name-search tests passed on the first run against the real API.
- What the suite does and does not check is measured in `results/` (clean stub run, faults, lint, weak assertions), not claimed here.

## Cross-check with the official harness runs (2026-10-21)

From `results/suite-a.json`, as measured after the sessions (not part of the agent's claim): clean stub 8 of 8 passed, 10 of 10 faults caught, no flaky test over 5 repeats, public API 8 of 8, lint with the measure config 17 errors (type-aware `no-unsafe-*` rules; the agent never ran a linter), `tsc` 0 errors. The statements in the final message that can be checked (8 tests pass, seven behaviours covered) hold in the harness runs too.
