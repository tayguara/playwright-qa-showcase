import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { countLint, countTypeErrors } from '../lint-count.mjs';
import { REPO_ROOT, tscCommand } from '../suites.mjs';

describe('countTypeErrors', () => {
  test('counts plain tsc error lines', () => {
    const output =
      "tests/a.spec.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n" +
      "tests/b.ts(1,1): error TS2304: Cannot find name 'x'.\n";
    assert.equal(countTypeErrors(output), 2);
  });

  test('colour codes (pretty output) would hide the errors, which is why tsc runs with --pretty false', () => {
    const pretty =
      '\u001b[96ma.ts\u001b[0m:\u001b[93m1\u001b[0m - \u001b[91merror\u001b[0m\u001b[90m TS2322: \u001b[0mType';
    assert.equal(countTypeErrors(pretty), 0);
  });

  test('a real type error is counted, also when FORCE_COLOR is set (--pretty false wins)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tsc-test-'));
    try {
      writeFileSync(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['*.ts'] }),
      );
      writeFileSync(path.join(dir, 'a.ts'), 'const x: number = "not a number";\nexport { x };\n');
      const { command, args } = tscCommand({ id: 'A', cwd: dir });
      assert.ok(args.includes('--pretty'));
      let output = '';
      try {
        execFileSync(command, args, {
          cwd: dir,
          encoding: 'utf8',
          env: { ...process.env, FORCE_COLOR: '0' },
        });
      } catch (error) {
        output = error.stdout + error.stderr;
      }
      assert.equal(countTypeErrors(output), 1, output);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tsc comes from the repo, so the version matches the lock file', () => {
    assert.ok(tscCommand({ id: 'A', cwd: REPO_ROOT }).args[0].startsWith(REPO_ROOT));
  });
});

describe('countLint', () => {
  test('separates errors, warnings and fatal errors and counts by rule', () => {
    const results = [
      {
        messages: [
          { severity: 2, ruleId: 'a' },
          { severity: 1, ruleId: 'b' },
          { severity: 1, ruleId: 'b' },
        ],
      },
      {
        messages: [
          { fatal: true, severity: 2, ruleId: null },
          { severity: 2, ruleId: null },
        ],
      },
    ];
    assert.deepEqual(countLint(results), {
      files: 2,
      errors: 2,
      warnings: 2,
      fatal: 1,
      byRule: { b: 2, a: 1, '(no rule)': 1 },
    });
  });
});
