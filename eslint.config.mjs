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
]);
