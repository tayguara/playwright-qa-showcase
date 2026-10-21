// Experiment harness CLI.
//
//   node harness/run.mjs <faults|repeat|public|lint|summary> --suite <H|A|B|all> [--port 4010] [--faults 0,3,10]
//
// faults  clean baseline, faults 1..10, and a second fault-10 run, each against a fresh stub
// repeat  one clean stub for the whole run, every test repeated 5 times
// public  the real sandbox, all suites back to back (aborts if /ping does not answer 201)
// lint    ESLint (measure config for A and B) and tsc, per suite
// summary renders results/summary.md
//
// `--faults` restricts the fault run for debugging; such a run is marked "complete": false.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FAULTS } from '../stub/faults.mjs';
import { classifyFaultRun, findRepeatFlaky, flattenReport, summarizeRun } from './analyze.mjs';
import { renderSummary } from './report.mjs';
import { assertNoSymlinks } from './guard.mjs';
import { countLint, countTypeErrors } from './lint-count.mjs';
import { runInSandbox, runSandboxed } from './sandbox.mjs';
import { runProcess, withStub } from './stub-process.mjs';
import {
  PUBLIC_BASE_URL,
  REPO_ROOT,
  RESULTS_DIR,
  SUITES,
  childEnv,
  eslintCommand,
  lintResultsPath,
  playwrightCommand,
  playwrightVersion,
  rawDir,
  selectSuites,
  stubSha256,
  suiteResultsPath,
  tscCommand,
} from './suites.mjs';

const MODES = ['faults', 'repeat', 'public', 'lint', 'summary'];
const USAGE = `Usage: node harness/run.mjs <${MODES.join('|')}> --suite <H|A|B|all> [--port 4010] [--faults 0,3,10]`;
const REPEAT_EACH = 5;

// ---- small helpers ---------------------------------------------------------------------------------

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (!MODES.includes(mode)) throw new Error(`Unknown or missing mode.\n${USAGE}`);
  const options = { mode, suite: 'all', port: 4010, faults: undefined };
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (value === undefined) throw new Error(`Missing value for ${flag}.\n${USAGE}`);
    if (flag === '--suite') options.suite = value;
    else if (flag === '--port') options.port = Number(value);
    else if (flag === '--faults') options.faults = parseFaultList(value);
    else throw new Error(`Unknown option ${flag}.\n${USAGE}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid --port.\n${USAGE}`);
  }
  return options;
}

function parseFaultList(value) {
  const ids = value.split(',').map((part) => Number(part.trim()));
  if (ids.some((id) => !Number.isInteger(id) || id < 0 || id > 10)) {
    throw new Error(`--faults takes a comma-separated list of numbers 0..10, got "${value}"`);
  }
  return [...new Set(ids)];
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonIfExists(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
}

/** Absolute paths must not end up in committed evidence: the repo path becomes <repo>, home <home>. */
function sanitize(text) {
  return text.split(REPO_ROOT).join('<repo>').split(os.homedir()).join('<home>');
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

const gitSha = () => git('rev-parse', 'HEAD') ?? 'unknown';

/** True when the only network interfaces are loopback ones (inside `unshare -rn`). */
function isOffline() {
  return Object.values(os.networkInterfaces())
    .flat()
    .every((iface) => iface === undefined || iface.internal);
}

function writeEnvironment(mode) {
  const file = path.join(RESULTS_DIR, 'environment.json');
  const previous = readJsonIfExists(file) ?? {};
  const modes = {
    ...previous.modes,
    [mode]: { at: new Date().toISOString(), offline: isOffline() },
  };
  writeJson(file, {
    nodeVersion: process.version,
    playwrightVersion: playwrightVersion(),
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    gitSha: gitSha(),
    // Source files only: the harness's own results/ folder is output, not code under test.
    gitDirty:
      (git(
        'status',
        '--porcelain',
        '--',
        'experiments',
        ':!experiments/ai-written-tests/results',
        'tests',
        'src',
        'config',
      ) ?? '') !== '',
    date: new Date().toISOString(),
    stubSha256: stubSha256(),
    // Official stub runs need BOTH faults and repeat inside the offline wrapper; per-mode flags
    // in `modes` show which one did not.
    offline: modes.faults?.offline === true && modes.repeat?.offline === true,
    modes,
  });
}

/** Updates results/suite-x.json, keeping the sections that other modes wrote earlier. */
function updateSuiteResults(suite, patch) {
  const file = suiteResultsPath(suite);
  const merged = {
    ...readJsonIfExists(file),
    suite: suite.id,
    label: suite.label,
    source: suite.source,
    gitSha: gitSha(),
    stubSha256: stubSha256(),
    ...patch,
  };
  writeJson(file, merged);
  return merged;
}

// ---- running one suite -------------------------------------------------------------------------------

function loadReport(suite, rawName, rawPath, run) {
  const text = readFileSync(rawPath, 'utf8');
  if (text.trim() === '') {
    const reason = run.timedOut ? 'timed out' : `exit code ${run.exitCode}`;
    throw new Error(
      `Suite ${suite.id} (${rawName}) wrote no JSON report (${reason}).\n${run.stderrTail || run.stdoutTail}`,
    );
  }
  writeFileSync(rawPath, sanitize(text));
  return JSON.parse(sanitize(text));
}

function prepareRaw(suite, rawName) {
  const rawPath = path.join(rawDir(suite), `${rawName}.json`);
  mkdirSync(path.dirname(rawPath), { recursive: true });
  writeFileSync(rawPath, ''); // so a stale report from an earlier run can never be read back
  return rawPath;
}

/**
 * Runs the suite's Playwright command once, against `baseUrl`, and returns the parsed report.
 * Test failures are normal (exit code 1); a missing report means the run itself broke.
 * Suites A and B (AI-written code) run in the sandbox with egress through pasta; this path is
 * only used for the public run and for suite H.
 */
async function runSuite(suite, { baseUrl, rawName, extraArgs = [] }) {
  const rawPath = prepareRaw(suite, rawName);
  let run;
  if (suite.sandboxed) {
    run = await runSandboxed(suite, { fault: null, baseUrl, extraArgs, network: 'egress' });
    if (run.reportText !== undefined) writeFileSync(rawPath, run.reportText);
  } else {
    const { command, args, cwd } = playwrightCommand(suite, extraArgs);
    run = await runProcess(command, args, { cwd, env: childEnv({ baseUrl, rawPath }) });
  }
  return loadReport(suite, rawName, rawPath, run);
}

/**
 * One run against a fresh stub. Suite H: the stub is a host process. Suites A and B: the stub and
 * the suite both run inside one sandbox without network (loopback only).
 */
async function runAgainstStub(suite, { fault, port, rawName, extraArgs = [] }) {
  if (suite.sandboxed) {
    const rawPath = prepareRaw(suite, rawName);
    const run = await runSandboxed(suite, { fault, port, extraArgs, network: 'none' });
    if (run.reportText !== undefined) writeFileSync(rawPath, run.reportText);
    return {
      flat: flattenReport(loadReport(suite, rawName, rawPath, run)),
      requests: run.requests,
    };
  }
  const { result: report, requests } = await withStub({ fault, port }, (url) =>
    runSuite(suite, { baseUrl: url, rawName, extraArgs }),
  );
  return { flat: flattenReport(report), requests };
}

const failingKeys = (flat) =>
  flat.tests
    .filter((t) => t.statuses.includes('unexpected'))
    .map((t) => t.key)
    .sort();

// ---- modes ---------------------------------------------------------------------------------------------

async function runFaults(suite, { port, faults }) {
  const subset = faults !== undefined;
  const selected = FAULTS.filter((f) => (subset ? faults.includes(f.id) : true));
  console.log(`[${suite.id}] clean baseline`);

  const baseline = await runAgainstStub(suite, { fault: 0, port, rawName: 'clean' });
  const clean = {
    ...summarizeRun(baseline.flat),
    requests: baseline.requests,
    globalErrors: baseline.flat.globalErrors.length,
    tests: baseline.flat.tests.map((t) => ({ key: t.key, status: t.statuses[0] })),
  };
  console.log(
    `[${suite.id}] clean: ${clean.passed}/${clean.total - clean.skipped} passed, ${clean.requests} requests`,
  );

  const faultResults = [];
  const runs = new Map();
  for (const fault of selected) {
    const rawName = `fault-${String(fault.id).padStart(2, '0')}`;
    const run = await runAgainstStub(suite, { fault: fault.id, port, rawName });
    runs.set(fault.id, run);
    const verdict = classifyFaultRun({
      baseline: baseline.flat,
      run: run.flat,
      requests: run.requests,
    });
    faultResults.push({
      fault: fault.id,
      slug: fault.slug,
      status: verdict.status,
      failingTests: verdict.failingTests,
      flakyTests: verdict.flakyTests,
      newGlobalErrors: verdict.newGlobalErrors,
      unknownFailingTests: verdict.unknownFailingTests,
      requests: run.requests,
    });
    console.log(
      `[${suite.id}] fault ${fault.id} ${fault.slug}: ${verdict.status} (${verdict.failingTests.length} failing)`,
    );
  }

  // Fault 10 depends on request counts, so it runs twice to show the outcome is repeatable.
  let fault10Deterministic;
  if (runs.has(10)) {
    const rerun = await runAgainstStub(suite, { fault: 10, port, rawName: 'fault-10-rerun' });
    fault10Deterministic =
      JSON.stringify(failingKeys(runs.get(10).flat)) === JSON.stringify(failingKeys(rerun.flat));
    console.log(`[${suite.id}] fault 10 rerun: deterministic = ${fault10Deterministic}`);
  }

  updateSuiteResults(suite, {
    stub: {
      complete: !subset,
      completedAt: new Date().toISOString(),
      stubSha256: stubSha256(),
      clean,
      faults: faultResults,
      ...(fault10Deterministic === undefined ? {} : { fault10Deterministic }),
      faultsCaught: faultResults.filter((f) => f.status === 'caught').length,
    },
  });
}

async function runRepeat(suite, { port }) {
  console.log(`[${suite.id}] repeat x${REPEAT_EACH} on one clean stub`);
  const { flat } = await runAgainstStub(suite, {
    fault: 0,
    port,
    rawName: 'repeat',
    extraArgs: [`--repeat-each=${REPEAT_EACH}`],
  });
  const { flakyTests, consistentlyFailing } = findRepeatFlaky(flat);
  updateSuiteResults(suite, {
    repeat: {
      repeatEach: REPEAT_EACH,
      executions: summarizeRun(flat).total,
      stubSha256: stubSha256(),
      flakyTests,
      consistentlyFailing,
    },
  });
  console.log(
    `[${suite.id}] repeat: ${flakyTests.length} flaky, ${consistentlyFailing.length} failing every time`,
  );
}

/** All suites run back to back against the real sandbox; one failure of /ping aborts the set. */
async function runPublic(suites) {
  let ping;
  try {
    ping = await fetch(`${PUBLIC_BASE_URL}/ping`, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new Error(
      `GET /ping on the public sandbox failed (${error.message}); aborting the set, retry later`,
      { cause: error },
    );
  }
  if (ping.status !== 201) {
    throw new Error(`GET /ping answered ${ping.status}, not 201; aborting the set, retry later`);
  }

  // Collect everything first: nothing is written unless every suite produced a report.
  const collected = [];
  for (const suite of suites) {
    const ranAt = new Date().toISOString();
    console.log(`[${suite.id}] public run`);
    const report = await runSuite(suite, { baseUrl: PUBLIC_BASE_URL, rawName: 'public' });
    const { total, passed, failed, flaky, skipped, passRate } = summarizeRun(flattenReport(report));
    collected.push([suite, { ranAt, total, passed, failed, flaky, skipped, passRate }]);
  }
  for (const [suite, section] of collected) {
    updateSuiteResults(suite, { public: section });
    console.log(
      `[${suite.id}] public: ${section.passed}/${section.total - section.skipped} passed`,
    );
  }
}

/**
 * Runs an analysis command: suites A and B inside the sandbox (no network, nothing writable, the
 * suite folder read-only), suite H directly. tsc and ESLint do not execute the suite, but they read
 * whatever it points to, which is why the sandbox hides the host's files from them.
 */
function runAnalysis(suite, { command, args, cwd }) {
  if (suite.sandboxed) return runInSandbox({ suite, command, args, network: 'none' });
  // FORCE_COLOR is not set: tsc switches to coloured "pretty" output when it is.
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  return runProcess(command, args, { cwd, env });
}

async function runLint(suite) {
  console.log(`[${suite.id}] lint`);
  const lint = await runAnalysis(suite, eslintCommand(suite));
  let results;
  try {
    results = JSON.parse(lint.stdout);
  } catch (error) {
    throw new Error(`ESLint produced no JSON for suite ${suite.id}: ${lint.stderrTail}`, {
      cause: error,
    });
  }
  const raw = sanitize(JSON.stringify(results, null, 2));
  mkdirSync(path.dirname(lintResultsPath(suite)), { recursive: true });
  writeFileSync(lintResultsPath(suite), `${raw}\n`);

  const typecheck = await runAnalysis(suite, tscCommand(suite));
  const tscOutput = typecheck.stdout + typecheck.stderrTail;
  const typeErrors = countTypeErrors(tscOutput);
  writeFileSync(lintResultsPath(suite).replace(/\.eslint\.json$/, '.tsc.txt'), sanitize(tscOutput));

  const counts = countLint(JSON.parse(raw));
  updateSuiteResults(suite, { lint: counts, typecheck: { errors: typeErrors } });
  console.log(
    `[${suite.id}] lint: ${counts.errors} errors, ${counts.warnings} warnings, ${counts.fatal} fatal; tsc: ${typeErrors} errors`,
  );
}

function runSummary() {
  const suites = {};
  for (const suite of Object.values(SUITES))
    suites[suite.id] = readJsonIfExists(suiteResultsPath(suite));
  const weak = readJsonIfExists(path.join(RESULTS_DIR, 'weak-assertions.json')) ?? null;
  const file = path.join(RESULTS_DIR, 'summary.md');
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(file, renderSummary({ suites, weak }));
  console.log(`Wrote ${path.relative(REPO_ROOT, file)}`);
}

// ---- main --------------------------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === 'summary') return runSummary();

  const { runnable, skipped } = selectSuites(options.suite);
  for (const message of skipped) console.log(message);
  if (runnable.length === 0) throw new Error('No suite to run');
  // AI-written suites must not contain symlinks (they could point at host files).
  for (const suite of runnable) if (suite.sandboxed) assertNoSymlinks(suite);

  writeEnvironment(options.mode);
  if (options.mode === 'public') await runPublic(runnable);
  else {
    for (const suite of runnable) {
      if (options.mode === 'faults') await runFaults(suite, options);
      else if (options.mode === 'repeat') await runRepeat(suite, options);
      else await runLint(suite);
    }
  }
  runSummary();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
