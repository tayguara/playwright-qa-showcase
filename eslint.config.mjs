import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'node_modules/',
    '.features-gen/',
    'playwright-report/',
    'blob-report/',
    'test-results/',
    'all-blob-reports/',
    'playwright/.cache/',
    // The AI-written suites and the experiment's evidence are measured, never linted by the repo.
    'experiments/ai-written-tests/suite-a/',
    'experiments/ai-written-tests/suite-b/',
    'experiments/ai-written-tests/results/',
    'experiments/ai-written-tests/prompts/',
  ]),

  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['tests/**/*.ts', 'features/steps/**/*.ts', 'src/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-skipped-test': 'error',
      'playwright/no-force-option': 'error',
    },
  },

  // Step definitions hold their assertions inside Given/When/Then callbacks, not test().
  {
    files: ['features/steps/**/*.ts'],
    rules: {
      'playwright/no-standalone-expect': 'off',
      'playwright/expect-expect': 'off',
    },
  },

  // Plain JS/config files are not part of the TypeScript project.
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
  },

  // The experiment's stub and harness are plain Node ESM scripts. The globals they use are listed
  // here instead of adding the `globals` package.
  {
    files: ['experiments/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortSignal: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
]);
