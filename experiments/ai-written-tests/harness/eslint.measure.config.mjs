// ESLint config used only to MEASURE suites A and B (never to enforce anything on them).
//
// It mirrors the rules of the root eslint.config.mjs as they stood at pre-registration, so that
// all three suites are judged by the same rules. The root config scopes the Playwright rules to
// tests/**, features/steps/** and src/**; the agents' folder layouts are not known in advance,
// so here those rules apply to EVERY .ts file. Run it with the suite folder as cwd:
//
//   node <repo>/node_modules/eslint/bin/eslint.js --config <this file> --format json .
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['node_modules/', 'test-results/', 'playwright-report/', 'blob-report/']),

  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      playwright.configs['flat/recommended'],
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        // With --config, ESLint resolves files from the cwd, which is the suite folder.
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-skipped-test': 'error',
      'playwright/no-force-option': 'error',
    },
  },

  // Plain JS/config files are not part of the TypeScript project.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
  },
]);
