/**
 * SauceDemo user names (public, documented on the login page). The shared password lives in
 * config/env.ts, never in feature files.
 */
export const SAUCE_USERS = ['standard_user', 'locked_out_user', 'problem_user'] as const;

export type SauceUser = (typeof SAUCE_USERS)[number];

/** Narrows a free-form name coming from a Gherkin step to a known SauceDemo user. */
export function toSauceUser(name: string): SauceUser {
  const user = SAUCE_USERS.find((candidate) => candidate === name);
  if (!user) {
    throw new Error(`Unknown SauceDemo user "${name}". Known users: ${SAUCE_USERS.join(', ')}`);
  }
  return user;
}
