import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { classifyFaultRun, findRepeatFlaky, flattenReport, summarizeRun } from '../analyze.mjs';

const fixture = (name) =>
  flattenReport(
    JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')),
  );

const KEYS = {
  T1: 'api › tests/api/a.spec.ts › POST /auth › T1 title',
  T2: 'api › tests/api/a.spec.ts › POST /auth › T2 title',
  T3: 'api › tests/api/b.spec.ts › T3 title',
  T4: 'api › tests/api/b.spec.ts › T4 title',
  T9: 'api › tests/api/b.spec.ts › T9 title',
};

describe('flattenReport', () => {
  test('builds keys from project, file, describe titles and test title', () => {
    const flat = fixture('baseline');
    assert.deepEqual(
      flat.tests.map((t) => t.key),
      [KEYS.T1, KEYS.T2, KEYS.T3],
    );
    assert.deepEqual(flat.tests[0], {
      key: KEYS.T1,
      project: 'api',
      file: 'tests/api/a.spec.ts',
      title: 'T1 title',
      statuses: ['expected'],
    });
  });

  test('keeps the file-level suite out of the key but keeps nested describes', () => {
    const [first, , third] = fixture('baseline').tests;
    assert.ok(first.key.includes('POST /auth'));
    assert.equal(third.key, 'api › tests/api/b.spec.ts › T3 title');
  });

  test('collects the statuses of repeated executions under one key', () => {
    const flat = fixture('repeat');
    const t2 = flat.tests.find((t) => t.key === KEYS.T2);
    assert.deepEqual(t2.statuses, ['expected', 'expected', 'unexpected', 'expected', 'expected']);
    assert.equal(flat.tests.length, 4);
  });

  test('returns global errors and the stats block', () => {
    const flat = fixture('fault-global-error');
    assert.equal(flat.globalErrors.length, 1);
    assert.equal(flat.stats.expected, 3);
    assert.deepEqual(fixture('baseline').globalErrors, []);
  });

  test('an empty or minimal report flattens to nothing', () => {
    assert.deepEqual(flattenReport({ suites: [], errors: [], stats: {} }).tests, []);
    assert.deepEqual(flattenReport({}).globalErrors, []);
  });
});

describe('summarizeRun', () => {
  test('counts executions by status', () => {
    assert.deepEqual(summarizeRun(fixture('baseline')), {
      total: 3,
      passed: 3,
      failed: 0,
      flaky: 0,
      skipped: 0,
      passRate: 1,
    });
  });

  test('passRate excludes skipped tests from the denominator', () => {
    const summary = summarizeRun(fixture('with-skipped'));
    assert.deepEqual(summary, {
      total: 5,
      passed: 3,
      failed: 1,
      flaky: 0,
      skipped: 1,
      passRate: 0.75,
    });
  });

  test('flaky executions are neither passed nor failed but stay in the denominator', () => {
    const summary = summarizeRun(fixture('fault-flaky-only'));
    assert.deepEqual(summary, {
      total: 3,
      passed: 2,
      failed: 0,
      flaky: 1,
      skipped: 0,
      passRate: 2 / 3,
    });
  });

  test('counts every repeated execution', () => {
    const summary = summarizeRun(fixture('repeat'));
    assert.equal(summary.total, 20);
    assert.equal(summary.passed, 5 + 4 + 0 + 4);
    assert.equal(summary.failed, 1 + 5);
    assert.equal(summary.flaky, 1);
  });

  test('a run with nothing to run has passRate 0, not NaN', () => {
    const summary = summarizeRun(fixture('all-skipped'));
    assert.equal(summary.skipped, 2);
    assert.equal(summary.passRate, 0);
    assert.equal(summarizeRun(flattenReport({})).passRate, 0);
  });
});

describe('classifyFaultRun', () => {
  const baseline = fixture('baseline');

  test('caught: a baseline-passing test fails under the fault', () => {
    const result = classifyFaultRun({ baseline, run: fixture('fault-caught'), requests: 25 });
    assert.deepEqual(result, {
      status: 'caught',
      failingTests: [KEYS.T2],
      flakyTests: [],
      newGlobalErrors: 0,
      unknownFailingTests: [],
    });
  });

  test('missed: nothing changed', () => {
    const result = classifyFaultRun({ baseline, run: fixture('fault-missed'), requests: 25 });
    assert.equal(result.status, 'missed');
    assert.deepEqual(result.failingTests, []);
  });

  test('flaky results are recorded but not counted as caught', () => {
    const result = classifyFaultRun({ baseline, run: fixture('fault-flaky-only'), requests: 25 });
    assert.equal(result.status, 'missed');
    assert.deepEqual(result.flakyTests, [KEYS.T2]);
  });

  test('a new global error counts as caught', () => {
    const result = classifyFaultRun({ baseline, run: fixture('fault-global-error'), requests: 25 });
    assert.equal(result.status, 'caught');
    assert.equal(result.newGlobalErrors, 1);
    assert.deepEqual(result.failingTests, []);
  });

  test('a global error the baseline already had does not count', () => {
    const result = classifyFaultRun({
      baseline: fixture('baseline-with-global-error'),
      run: fixture('fault-global-error'),
      requests: 25,
    });
    assert.equal(result.status, 'missed');
    assert.equal(result.newGlobalErrors, 0);
  });

  test('tests that already failed in the baseline are excluded', () => {
    const result = classifyFaultRun({
      baseline: fixture('baseline-with-failing'),
      run: fixture('fault-failing-test-already-failing'),
      requests: 25,
    });
    assert.equal(result.status, 'missed');
    assert.deepEqual(result.failingTests, []);
  });

  test('a failing test with no key in the baseline counts, and is flagged', () => {
    const result = classifyFaultRun({ baseline, run: fixture('fault-unknown-key'), requests: 25 });
    assert.equal(result.status, 'caught');
    assert.deepEqual(result.failingTests, [KEYS.T9]);
    assert.deepEqual(result.unknownFailingTests, [KEYS.T9]);
  });

  test('requests = 0 is invalid, whatever the run says', () => {
    const result = classifyFaultRun({ baseline, run: fixture('fault-caught'), requests: 0 });
    assert.equal(result.status, 'invalid');
  });

  test('failing tests are returned in a stable order', () => {
    const run = fixture('fault-caught');
    const result = classifyFaultRun({ baseline, run, requests: 5 });
    assert.deepEqual(result.failingTests, [...result.failingTests].sort());
  });
});

describe('findRepeatFlaky', () => {
  test('separates mixed outcomes from consistent failures', () => {
    const result = findRepeatFlaky(fixture('repeat'));
    assert.deepEqual(result.flakyTests, [KEYS.T2, KEYS.T4]);
    assert.deepEqual(result.consistentlyFailing, [KEYS.T3]);
  });

  test('a clean run has neither', () => {
    assert.deepEqual(findRepeatFlaky(fixture('baseline')), {
      flakyTests: [],
      consistentlyFailing: [],
    });
  });

  test('skipped executions are ignored', () => {
    assert.deepEqual(findRepeatFlaky(fixture('all-skipped')), {
      flakyTests: [],
      consistentlyFailing: [],
    });
  });
});
