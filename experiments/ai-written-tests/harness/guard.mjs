// Guards for suites that an AI wrote and for files a sandboxed run leaves behind.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Relative paths of every symbolic link under `dir`, at any depth. A symlink in a suite can make
 * ESLint, tsc or Playwright read a file outside the suite (for example ~/.ssh/...) and copy it into
 * committed results, so suites that contain one are refused. Never follows links.
 */
export function findSymlinks(dir, base = dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) found.push(path.relative(base, full));
    else if (entry.isDirectory()) found.push(...findSymlinks(full, base));
  }
  return found.sort();
}

/** Throws with a clear message when the suite folder contains any symlink. */
export function assertNoSymlinks(suite) {
  const links = findSymlinks(suite.cwd);
  if (links.length > 0) {
    throw new Error(
      `Refusing to use suite ${suite.id}: ${suite.source} contains symbolic links (${links.join(', ')}). ` +
        'Remove them and review the files; a copy must not preserve symlinks.',
    );
  }
}

/**
 * Reads one file the sandbox was allowed to write, refusing anything that is not a plain regular
 * file (a symlink, directory, FIFO or device) or that is too large. lstat does not follow links,
 * and the sandbox has exited by the time this runs, so nothing can swap the file in between.
 */
export function readSandboxFile(dir, name, maxBytes = 64 * 1024 * 1024) {
  const file = path.join(dir, name);
  let stats;
  try {
    stats = lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!stats.isFile()) {
    throw new Error(
      `The sandboxed run left ${name} as something other than a regular file (symlink or special file); refusing to read it`,
    );
  }
  if (stats.size > maxBytes) {
    throw new Error(
      `The sandboxed run left a ${name} larger than ${maxBytes} bytes; refusing to read it`,
    );
  }
  return readFileSync(file, 'utf8');
}
