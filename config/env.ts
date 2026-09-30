import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Optional local overrides. Variables already present in the environment (e.g. CI) win.
const envFile = resolve(__dirname, '..', '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/**
 * Single source of truth for target URLs and credentials.
 *
 * The defaults are the PUBLIC demo credentials documented by the sandbox sites themselves
 * (saucedemo.com and restful-booker.herokuapp.com). They are not secrets. In a real project
 * these values would come from CI secrets and never be committed.
 */
export const env = {
  sauce: {
    baseUrl: process.env.SAUCE_BASE_URL ?? 'https://www.saucedemo.com',
    password: process.env.SAUCE_PASSWORD ?? 'secret_sauce',
  },
  booker: {
    baseUrl: process.env.BOOKER_BASE_URL ?? 'https://restful-booker.herokuapp.com',
    username: process.env.BOOKER_USERNAME ?? 'admin',
    password: process.env.BOOKER_PASSWORD ?? 'password123',
  },
} as const;
