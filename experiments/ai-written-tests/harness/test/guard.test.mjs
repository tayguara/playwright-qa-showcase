import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { assertNoSymlinks, findSymlinks, readSandboxFile } from '../guard.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));
after(() => rmSync(root, { recursive: true, force: true }));

const fresh = (name) => {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe('readSandboxFile', () => {
  test('reads a regular file', () => {
    const dir = fresh('regular');
    writeFileSync(path.join(dir, 'report.json'), '{"ok":true}');
    assert.equal(readSandboxFile(dir, 'report.json'), '{"ok":true}');
  });

  test('a missing file is undefined, not an error', () => {
    assert.equal(readSandboxFile(fresh('missing'), 'report.json'), undefined);
  });

  test('refuses a symlink, even to a readable file, and never reads through it', () => {
    const dir = fresh('symlink');
    const target = path.join(root, 'secret.txt');
    writeFileSync(target, 'SECRET');
    symlinkSync(target, path.join(dir, 'report.json'));
    assert.throws(() => readSandboxFile(dir, 'report.json'), /regular file/);
  });

  test('refuses a dangling symlink and a directory', () => {
    const dir = fresh('other');
    symlinkSync(path.join(root, 'nowhere'), path.join(dir, 'outcome.json'));
    mkdirSync(path.join(dir, 'report.json'));
    assert.throws(() => readSandboxFile(dir, 'outcome.json'), /regular file/);
    assert.throws(() => readSandboxFile(dir, 'report.json'), /regular file/);
  });

  test('refuses a file over the size limit', () => {
    const dir = fresh('big');
    writeFileSync(path.join(dir, 'report.json'), 'x'.repeat(50));
    assert.throws(() => readSandboxFile(dir, 'report.json', 10), /larger than/);
  });
});

describe('findSymlinks and assertNoSymlinks', () => {
  test('finds links at any depth, files and directories, without following them', () => {
    const dir = fresh('suite');
    mkdirSync(path.join(dir, 'tests', 'deep'), { recursive: true });
    writeFileSync(path.join(dir, 'tests', 'a.spec.ts'), '');
    symlinkSync('/etc/passwd', path.join(dir, 'tests', 'key.ts'));
    symlinkSync('/etc', path.join(dir, 'tests', 'deep', 'etc'));
    assert.deepEqual(findSymlinks(dir), ['tests/deep/etc', 'tests/key.ts']);
  });

  test('a suite without links passes; one with a link is refused with a clear message', () => {
    const clean = fresh('clean-suite');
    writeFileSync(path.join(clean, 'package.json'), '{}');
    assertNoSymlinks({ id: 'A', cwd: clean, source: 'suite-a' });

    const dirty = fresh('dirty-suite');
    symlinkSync('/etc/passwd', path.join(dirty, 'ref.ts'));
    assert.throws(
      () => assertNoSymlinks({ id: 'A', cwd: dirty, source: 'suite-a' }),
      /symbolic links \(ref\.ts\)/,
    );
  });
});
