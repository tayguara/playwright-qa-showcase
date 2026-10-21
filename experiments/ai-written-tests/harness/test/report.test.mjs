import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inline, renderSummary } from '../report.mjs';

describe('inline', () => {
  test('turns line breaks and control characters into spaces', () => {
    assert.equal(inline('a\nb\r\nc\u2028d\u0000e'), 'a b c d e');
  });

  test('escapes the characters that start Markdown tables, code or HTML', () => {
    assert.equal(inline('a|b`c<d>e'), 'a\\|b\\`c\\<d\\>e');
  });

  test('caps the length', () => {
    assert.equal(inline('x'.repeat(500), 10), 'xxxxxxxxxx...');
  });
});

describe('renderSummary with hostile suite-provided strings', () => {
  const clean = {
    total: 1,
    passed: 1,
    failed: 0,
    flaky: 0,
    skipped: 0,
    passRate: 1,
    requests: 5,
    globalErrors: 0,
    tests: [{ key: 'k', status: 'expected' }],
  };
  const hostile = 'api › x\n\n# Injected heading\n- injected item\nscript-shell=/tmp/payload.sh';
  const suiteA = {
    suite: 'A',
    label: 'Evil\n# injected label',
    source: 'evil\nsource',
    gitSha: 'abc',
    stubSha256: 's',
    stub: {
      complete: true,
      stubSha256: 's',
      clean,
      faults: [
        {
          fault: 1,
          slug: 'get-wrong-totalprice',
          status: 'caught',
          failingTests: [hostile],
          flakyTests: [],
          newGlobalErrors: 0,
          requests: 3,
        },
      ],
      faultsCaught: 1,
    },
    repeat: {
      repeatEach: 5,
      executions: 5,
      stubSha256: 's',
      flakyTests: [hostile],
      consistentlyFailing: [hostile],
    },
    lint: { files: 1, errors: 1, warnings: 0, fatal: 0, byRule: { 'evil\n# rule': 1 } },
  };
  const markdown = renderSummary({ suites: { A: suiteA } });

  test('no suite-provided text can start a new line', () => {
    for (const line of markdown.split('\n')) {
      assert.equal(line.startsWith('# Injected'), false, line);
      assert.equal(line.startsWith('- injected'), false, line);
      assert.equal(line.startsWith('script-shell'), false, line);
      assert.equal(line.startsWith('# injected'), false, line);
    }
  });

  test('the label and source shown come from the constants, not from the results file', () => {
    assert.ok(markdown.includes('### Suite A: AI agent, no guardrails'));
    assert.equal(markdown.includes('Evil'), false);
    assert.equal(markdown.includes('evil\nsource'), false);
  });
});
