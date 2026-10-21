// Suite definitions (H, A, B), paths, and the environment every child process gets.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPERIMENT_DIR = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
export const REPO_ROOT = path.resolve(EXPERIMENT_DIR, '..', '..');
export const RESULTS_DIR = path.join(EXPERIMENT_DIR, 'results');
export const PUBLIC_BASE_URL = 'https://restful-booker.herokuapp.com';

// Inside the sandbox, the only writable path: a per-run scratch folder, bound here (see sandbox.mjs).
export const SANDBOX_OUT_DIR = '/work-out';

const PLAYWRIGHT_CLI = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const ESLINT_CLI = path.join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
const TSC_CLI = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

export const SUITES = {
  H: {
    id: 'H',
    label: 'Human-written (tests/api)',
    sandboxed: false, // the author's own reviewed code; see the README
    source: 'tests/api',
    cwd: REPO_ROOT,
    // The repo's own api project: its config sets baseURL, the Accept header and timeouts.
    playwrightArgs: ['test', '--config', 'playwright.config.ts', '--project=api', '--workers=1'],
    // Linted with the root config, on the files that make up suite H.
    lintFiles: [
      'tests/api',
      'src/api',
      'src/fixtures/api.fixtures.ts',
      'src/data/bookingBuilder.ts',
      'config/env.ts',
    ],
  },
  A: {
    id: 'A',
    label: 'AI agent, no guardrails',
    sandboxed: true,
    source: 'experiments/ai-written-tests/suite-a',
    cwd: path.join(EXPERIMENT_DIR, 'suite-a'),
    // The suite keeps the config the agent wrote; only workers and reporter are overridden.
    playwrightArgs: ['test', '--workers=1'],
  },
  B: {
    id: 'B',
    label: 'AI agent, with guardrails',
    sandboxed: true,
    source: 'experiments/ai-written-tests/suite-b',
    cwd: path.join(EXPERIMENT_DIR, 'suite-b'),
    playwrightArgs: ['test', '--workers=1'],
  },
};

export const suiteSlug = (suite) => suite.id.toLowerCase();
export const suiteExists = (suite) => existsSync(suite.cwd);
export const rawDir = (suite) => path.join(RESULTS_DIR, 'raw', suiteSlug(suite));
export const suiteResultsPath = (suite) => path.join(RESULTS_DIR, `suite-${suiteSlug(suite)}.json`);
export const lintResultsPath = (suite) =>
  path.join(RESULTS_DIR, 'lint', `${suiteSlug(suite)}.eslint.json`);

/** `node <repo>/node_modules/@playwright/test/cli.js test ... --reporter=json`, run in the suite folder. */
export function playwrightCommand(suite, extraArgs = []) {
  return {
    command: process.execPath,
    args: [PLAYWRIGHT_CLI, ...suite.playwrightArgs, '--reporter=json', ...extraArgs],
    cwd: suite.cwd,
  };
}

/** ESLint: suite H uses the root config on its own files; A and B use the measure config. */
export function eslintCommand(suite) {
  if (suite.id === 'H') {
    return {
      command: process.execPath,
      args: [ESLINT_CLI, '--format', 'json', ...suite.lintFiles],
      cwd: suite.cwd,
    };
  }
  return {
    command: process.execPath,
    args: [
      ESLINT_CLI,
      '--config',
      path.join(EXPERIMENT_DIR, 'harness', 'eslint.measure.config.mjs'),
      '--format',
      'json',
      '.',
    ],
    cwd: suite.cwd,
  };
}

/**
 * `tsc --noEmit --pretty false -p tsconfig.json` in the suite folder (the repo root for suite H).
 * `--pretty false` keeps the output free of colour codes so `error TS\d+` lines can be counted.
 */
export function tscCommand(suite) {
  return {
    command: process.execPath,
    args: [TSC_CLI, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'],
    cwd: suite.cwd,
  };
}

// Variables a child run may inherit. Everything else (API keys, tokens, cloud credentials, ...)
// is dropped, because the suites under test are code an AI wrote and `public` runs have network
// access. Raw reports are committed, so nothing secret may be printable by a test either.
const INHERITED_ENV =
  /^(PATH|HOME|LANG|LC_ALL|TMPDIR|TERM|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_USE_SYSTEM_CA|PLAYWRIGHT_[A-Z0-9_]*)$/;

/**
 * The environment of every child run, built from an allowlist: PATH, HOME, LANG, LC_ALL, TMPDIR,
 * TERM, NODE_OPTIONS, NODE_PATH, NODE_EXTRA_CA_CERTS, NODE_USE_SYSTEM_CA and PLAYWRIGHT_* from the
 * parent (NODE_AUTH_TOKEN and the like are NOT passed), plus the fixed values below (CI and any inherited
 * BOOKER_* are never passed on). Credentials are the sandbox's public demo ones.
 */
export function childEnv({ baseUrl, rawPath }, parentEnv = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(parentEnv)) {
    if (INHERITED_ENV.test(name) && value !== undefined) env[name] = value;
  }
  return {
    ...env,
    BOOKER_BASE_URL: baseUrl,
    BOOKER_USERNAME: 'admin',
    BOOKER_PASSWORD: 'password123',
    PLAYWRIGHT_JSON_OUTPUT_FILE: rawPath,
    FORCE_COLOR: '0',
  };
}

/** sha256 over the three stub source files: any change to the stub changes this value. */
export function stubSha256() {
  const hash = createHash('sha256');
  for (const name of ['faults.mjs', 'server.mjs', 'store.mjs']) {
    hash.update(`${name}\0`);
    hash.update(readFileSync(path.join(EXPERIMENT_DIR, 'stub', name)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function playwrightVersion() {
  const manifest = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'package.json');
  return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

/**
 * Resolves `--suite` to suite objects. For `all`, a missing A or B folder is skipped with a clear
 * message so that H-only runs work before the agent suites exist. Naming a missing suite
 * explicitly is an error.
 */
export function selectSuites(selector) {
  const wanted = selector.toLowerCase() === 'all' ? Object.keys(SUITES) : [selector.toUpperCase()];
  const runnable = [];
  const skipped = [];
  for (const id of wanted) {
    const suite = SUITES[id];
    if (!suite) throw new Error(`Unknown suite "${selector}": use H, A, B or all`);
    if (suiteExists(suite)) runnable.push(suite);
    else if (wanted.length === 1) {
      throw new Error(`Suite ${id} does not exist yet: ${suite.source} is missing`);
    } else {
      skipped.push(`Skipping suite ${id}: ${suite.source} does not exist yet`);
    }
  }
  return { runnable, skipped };
}
