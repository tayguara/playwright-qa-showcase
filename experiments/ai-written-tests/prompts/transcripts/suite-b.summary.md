# Suite B: transcript summary

Written by hand from `suite-b.jsonl` and `suite-b.session.jsonl` (sanitised copies). Run: 2026-10-21T18:44:45Z to 18:46:06Z, model `claude-sonnet-5-5`, Claude Code 2.1.304, exit status 0, 4 turns, cost 0.1374 USD, prompt sha256 `ea96958e...` (equal to `prompts/agent-prompt.md`). The folder had `CLAUDE.md` with the guardrails (sha256 `d67ca6e8...`, equal to `prompts/guardrails.md`).

## Files created

- `playwright.config.ts`: `testDir ./tests`, `fullyParallel`, `retries: 1`, list reporter, `baseURL` from `BOOKER_BASE_URL` with the public URL as default, default `Accept: application/json` header.
- `eslint.config.mjs`: typescript-eslint recommended plus the Playwright plugin's recommended rules on `tests/**/*.ts`.
- `tests/helpers.ts`: zod schemas (booking, created booking, token, id list), unique-data helpers, and fixtures (`token`, `trackedIds`, `trackBooking`, `createBooking`, `booking`) that delete every tracked booking at teardown.
- `tests/auth.spec.ts`: 4 tests. `tests/booking.spec.ts`: 13 tests. Every test has a one-line "Regression:" comment above it.

17 test executions in total. One of them, "PUT drops optional fields omitted from the replacement", is marked `test.fail` (it documents that the sandbox keeps `additionalneeds` when a PUT omits it). Nothing was committed (the lab repository still has only the scaffold and guardrails commits).

## Commands the agent ran

Three `Bash` calls and nothing else (no `Read`, `Write`, `Edit`, `Grep`, `WebFetch`):

1. `ls -a && cat package.json && ls node_modules | head -50 && ls node_modules/.bin | grep -i -E "eslint|tsc"; cat playwright.config.* tsconfig.json` (looked at the scaffold and which tools are installed).
2. One command that wrote all files with heredocs and ran `npx tsc && npx eslint . ; npx playwright test 2>&1 | tail -40`.
3. A `python3` script that edited `tests/helpers.ts` and `tests/booking.spec.ts`, then `npx tsc && npx eslint . && npx playwright test 2>&1 | tail -15`.

## Runs against the public API

Two runs. First: 16 tests, 15 passed and 1 failed ("PUT fully replaces the booking": the response contained `additionalneeds: "Breakfast"`, which the replacement had not sent). Second, after the edit: 17 passed, one of them the `test.fail` test.

## Documentation

The agent did not read the API documentation: no `WebFetch`, no `curl`. It found the `additionalneeds` behaviour from the failing run against the real API.

## Linting and type checking

Yes. `npx tsc` and `npx eslint .` were run twice (before and after the edit); the transcript shows the second run chained with `&&` before the test run, which then executed.

## Problems it hit

The failing PUT test in the first run. The agent changed its test so that the replacement always sends `additionalneeds`, and added a separate `test.fail` test for the quirk. This is an adaptation of the suite to the real API's behaviour made by the agent during generation, before the harness ran anything.

## Final message against what holds

The final message says `tsc`, ESLint and `npx playwright test` all pass, the final run was 17 passed with one `test.fail` test counted as a pass, nothing uses fixed waits, every test has a regression comment, bookings are deleted at teardown, and nothing was committed.

- The transcript's final run matches (17 passed, `tsc` and ESLint chained before it). There is no `waitForTimeout` or sleep in the files, every test has a comment, and the fixtures delete tracked bookings. No agent commit exists.
- The claim "documents the bug without breaking the run" holds only while the sandbox keeps its current behaviour; the message says so itself.
- What the suite does and does not catch is measured in `results/` (clean stub run, faults, lint, weak assertions), not claimed here.

## Cross-check with the official harness runs (2026-10-21)

From `results/suite-b.json`, as measured after the sessions (not part of the agent's claim): clean stub 17 of 17 passed (the `test.fail` test fails as expected on the stub, which keeps `additionalneeds` like the real API), 10 of 10 faults caught, no flaky test over 5 repeats, public API 17 of 17, `tsc` 0 errors, and lint with the measure config 4 errors. The measure config is the showcase's rule set (type-aware `no-unsafe-*` rules), which differs from the agent's own `eslint.config.mjs` (which passed in its run), so the two lint results do not contradict each other. The statement that `tsc`, ESLint and the tests pass holds for the agent's own configuration.
