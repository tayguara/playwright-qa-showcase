# Weak-assertion review

You are reviewing one Playwright API test suite written in TypeScript. You will be given the full source of the suite (tests, helpers and fixtures). Review it against the checklist below and nothing else.

## Checklist (version 1)

Apply it per test. Assertions in fixtures or helpers that a test uses count for that test. Each item hits at most once per test.

- **W1 Status-only.** The primary response is asserted only by status code (or `ok()`); its body is not checked.
- **W2 Existence or partial matchers where the exact value is known.** `toBeTruthy`, `toBeDefined`, `not.toBeNull`, `toHaveProperty(key)` without a value, `> 0`, or a check of one field while the full expected object is known.
- **W3 No read-back after a mutation.** POST/PUT/PATCH/DELETE is not followed by a GET (or equivalent) that verifies the persisted state.
- **W4 No contract or type validation.** The response body is used without a schema or explicit type checks on its fields.
- **W5 Inclusion-only search.** A filter or search result is checked only for containing the expected item (or for non-emptiness), not for excluding non-matching items.
- **W6 Negative path without a state check.** An auth or error test asserts the error status but not that the state is unchanged.
- **W7 Lenient status.** Ranges or alternatives (`toBeOK()`, `[200, 201].includes`, `< 300`) where the API's status is exact and documented.
- **W8 Assertions that may not run or are swallowed.** `expect` inside `if`/`try-catch`/loops that may run zero times, a test without `expect`, or an error caught and ignored.

## Instructions

For each test (Playwright `test()` call) list every checklist item that applies, quoting the line; output JSON `[{test,item,line}]`; do not judge anything outside the checklist.

Rules for the output:

- `test` is the full title of the `test()` call, `item` is one of `W1` to `W8`, and `line` is the source line you are quoting, copied exactly.
- Output only the JSON array, with no text before or after it.
- A test with no applicable item produces no entry.
