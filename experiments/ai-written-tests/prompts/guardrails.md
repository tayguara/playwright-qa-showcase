# Testing rules for this project

Follow these rules for every test you write in this project.

1. No hard waits. Never use fixed sleeps (`page.waitForTimeout`, `setTimeout`-based delays). Wait for a concrete condition, or do not wait at all.
2. Assert on what the API returns and what it does, not only on status codes. Check the response body, and after any operation that changes data, verify the side effect actually happened.
3. Validate response contracts. Parse response bodies with a schema (for example with zod) instead of trusting their shape.
4. Each test creates the data it needs and cleans it up afterwards, even when the test fails. Tests must not depend on each other, on execution order, or on data that already exists in the environment.
5. Cover negative and authorization paths, not only the happy path.
6. Before declaring the work done, run the linter (ESLint; add a configuration if the project has none) and the full test suite, and make both pass.
7. Above each test, write a one-line comment stating which regression it would catch, that is, which bug in the API would make it fail. If you cannot name one, the test is not worth keeping.
