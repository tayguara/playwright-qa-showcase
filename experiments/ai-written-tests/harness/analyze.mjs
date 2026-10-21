// Pure functions over a Playwright JSON report (reporter=json). No I/O, no clock.
//
// Test statuses in that report: 'expected' (passed as planned), 'unexpected' (failed),
// 'flaky' (failed, then passed on a retry) and 'skipped'. With --repeat-each=N a spec carries N
// test entries; they share a key here and their statuses are collected in one list.

const KEY_SEPARATOR = ' › ';

/**
 * Flattens a report into `{ tests, globalErrors, stats }`.
 * key = project › file › describe titles › test title. The top-level suite is the file, so its
 * title is left out of the key.
 */
export function flattenReport(json) {
  const byKey = new Map();

  const visitSpec = (spec, describes) => {
    for (const test of spec.tests ?? []) {
      const key = [test.projectName, spec.file, ...describes, spec.title].join(KEY_SEPARATOR);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          key,
          project: test.projectName,
          file: spec.file,
          title: spec.title,
          statuses: [],
        };
        byKey.set(key, entry);
      }
      entry.statuses.push(test.status);
    }
  };

  const visitSuite = (suite, describes) => {
    for (const spec of suite.specs ?? []) visitSpec(spec, describes);
    for (const child of suite.suites ?? []) visitSuite(child, [...describes, child.title]);
  };

  // Depth 0 is the file suite: it contributes its specs and children but no describe title.
  for (const fileSuite of json.suites ?? []) visitSuite(fileSuite, []);

  return {
    tests: [...byKey.values()],
    globalErrors: json.errors ?? [],
    stats: json.stats ?? {},
  };
}

/** Counts executions (every repetition counts) and the pass rate = passed / (total - skipped). */
export function summarizeRun(flat) {
  const counts = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const { statuses } of flat.tests) {
    for (const status of statuses) {
      counts.total += 1;
      if (status === 'expected') counts.passed += 1;
      else if (status === 'unexpected') counts.failed += 1;
      else if (status === 'flaky') counts.flaky += 1;
      else if (status === 'skipped') counts.skipped += 1;
    }
  }
  const runnable = counts.total - counts.skipped;
  return { ...counts, passRate: runnable > 0 ? counts.passed / runnable : 0 };
}

const errorMessage = (error) => error?.message ?? JSON.stringify(error);

/**
 * Decides whether a faulted run caught the fault, by comparing it with the clean baseline.
 *  - invalid: the stub never saw a request (the suite did not talk to it).
 *  - caught: a test that passed in the baseline fails now, a test unknown to the baseline fails,
 *    or the run has a global error that the baseline did not have.
 *  - missed: anything else. Tests that already failed in the baseline never count, and 'flaky'
 *    results are only reported.
 */
export function classifyFaultRun({ baseline, run, requests }) {
  const baselineStatuses = new Map(baseline.tests.map((t) => [t.key, t.statuses]));
  const baselineErrors = new Set(baseline.globalErrors.map(errorMessage));

  const failingTests = [];
  const unknownFailingTests = [];
  const flakyTests = [];

  for (const { key, statuses } of run.tests) {
    if (statuses.includes('flaky')) flakyTests.push(key);
    if (!statuses.includes('unexpected')) continue;

    const before = baselineStatuses.get(key);
    if (before === undefined) {
      failingTests.push(key);
      unknownFailingTests.push(key);
    } else if (before.length > 0 && before.every((status) => status === 'expected')) {
      failingTests.push(key);
    }
  }

  const newGlobalErrors = run.globalErrors.filter(
    (error) => !baselineErrors.has(errorMessage(error)),
  ).length;

  let status = 'missed';
  if (requests === 0) status = 'invalid';
  else if (failingTests.length > 0 || newGlobalErrors > 0) status = 'caught';

  return {
    status,
    failingTests: failingTests.sort(),
    flakyTests: flakyTests.sort(),
    newGlobalErrors,
    unknownFailingTests: unknownFailingTests.sort(),
  };
}

/**
 * For a --repeat-each run on one clean stub: tests with mixed outcomes (or Playwright's own
 * 'flaky') versus tests that failed every time. Skipped executions are ignored.
 */
export function findRepeatFlaky(flat) {
  const flakyTests = [];
  const consistentlyFailing = [];
  for (const { key, statuses } of flat.tests) {
    const ran = statuses.filter((status) => status !== 'skipped');
    if (ran.length === 0) continue;
    const mixed = ran.includes('expected') && ran.includes('unexpected');
    if (mixed || ran.includes('flaky')) flakyTests.push(key);
    else if (ran.every((status) => status === 'unexpected')) consistentlyFailing.push(key);
  }
  return { flakyTests: flakyTests.sort(), consistentlyFailing: consistentlyFailing.sort() };
}
