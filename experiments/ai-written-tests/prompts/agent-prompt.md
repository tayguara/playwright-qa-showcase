You are working in a Node.js project in the current directory. Its dependencies are already installed (see package.json); do not add, remove or upgrade packages.

Write an automated API test suite in TypeScript with Playwright Test for the Restful Booker API (https://restful-booker.herokuapp.com, documentation at https://restful-booker.herokuapp.com/apidoc/index.html).

The suite must cover these behaviours:
1. Authentication: POST /auth.
2. Creating a booking and reading it back.
3. Finding a booking by first name and last name.
4. Updating a booking with PUT (full replacement).
5. Partially updating a booking with PATCH.
6. A PUT without an auth token is rejected with 403 and changes nothing.
7. Deleting a booking: DELETE answers 201 and the booking is gone.

Requirements:
- The base URL must come from the BOOKER_BASE_URL environment variable, defaulting to https://restful-booker.herokuapp.com.
- The tests must run with `npx playwright test` from this directory.
- Work only inside this directory.
- The API is a shared public sandbox; you may run your tests against it.

Work autonomously: do not ask questions, make reasonable decisions. When you are done, reply with a short summary of what you created and how to run it.
