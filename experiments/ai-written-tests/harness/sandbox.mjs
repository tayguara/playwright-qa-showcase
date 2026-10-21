// Runs suites A and B (code an AI wrote) in a bubblewrap sandbox instead of directly on the host.
//
// What the code can see: /usr and the node install (read-only), the repo's node_modules and the
// experiment folder (read-only), a private /tmp (also its HOME), and two writable paths, both in a
// fresh per-run scratch folder: /work-out (the outcome files) and a disposable COPY of the suite
// folder mounted over the suite's own path, so a suite that writes into its folder (a cached
// token under .auth/, a data file) behaves as it does in the lab. The real suite folder and
// results/ are never writable: the host reads only two named files from /work-out afterwards
// (guard.mjs refuses symlinks and other non-regular files), writes the evidence into results/
// itself, and throws the copy away. The suite is checked for symlinks before it is copied.
//
//   network 'none'    faults, repeat, lint: a network namespace with only loopback; the stub runs
//                     inside the same sandbox, so nothing leaves it
//   network 'egress'  public mode: its own namespace through `pasta` (user-mode egress). Routes to
//                     the private IPv4 ranges (10/8, 172.16/12, 192.168/16, 100.64/10) are blocked
//                     and there is no IPv6, so the host's other addresses (Docker bridges, VPN,
//                     link-local) and services on them are unreachable; the on-link LAN subnet and
//                     the internet are reachable
//
// Suite H is the author's own reviewed code and still runs directly (see the README).

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertNoSymlinks, readSandboxFile } from './guard.mjs';
import { runProcess } from './stub-process.mjs';
import { EXPERIMENT_DIR, REPO_ROOT, SANDBOX_OUT_DIR } from './suites.mjs';

const ENTRY = path.join(EXPERIMENT_DIR, 'harness', 'sandbox-entry.mjs');
const NODE_ROOT = path.dirname(path.dirname(process.execPath));
const ETC_FILES = [
  '/etc/ssl',
  '/etc/pki',
  '/etc/crypto-policies',
  '/etc/hosts',
  '/etc/nsswitch.conf',
  '/etc/host.conf',
  '/etc/ld.so.cache',
  '/etc/ld.so.conf',
  '/etc/ld.so.conf.d',
  '/etc/os-release',
];

/**
 * Run by pasta inside its namespace before bwrap starts: unreachable routes for the private
 * ranges. The sandbox cannot remove them (no capabilities over this namespace). It fails closed
 * (`set -e`, exec only after every route was added). 169.254.0.0/16 is left alone because the DNS
 * forward lives at 169.254.1.1. pasta runs with -4 and the script disables IPv6 in the namespace:
 * otherwise the host's IPv6 link-local address would reach host services listening on [::], and the
 * kernel would still give the tap interface a link-local address of its own.
 */
export const ROUTE_SCRIPT =
  'set -e; echo 1 > /proc/sys/net/ipv6/conf/all/disable_ipv6; ' +
  'echo 1 > /proc/sys/net/ipv6/conf/default/disable_ipv6; ' +
  'for n in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10; do ' +
  'ip route add unreachable "$n"; done; exec "$@"';

export const PASTA = [
  '/usr/bin/pasta',
  '-4',
  '--config-net',
  '--no-map-gw',
  '--dns-forward',
  '169.254.1.1',
  '-t',
  'none',
  '-u',
  'none',
  '-T',
  'none',
  '-U',
  'none',
  '--',
  '/usr/bin/sh',
  '-c',
  ROUTE_SCRIPT,
  '_',
];

/** bwrap arguments (without the trailing command). Pure, so it can be unit tested. */
export function bwrapArgs({
  network,
  passwdDir,
  resolvConf,
  outDir,
  suiteCopy,
  suiteDir,
  existing = () => true,
}) {
  const args = [
    '--unshare-all',
    ...(network === 'egress' ? ['--share-net'] : []),
    '--die-with-parent',
    '--new-session',
    '--uid',
    String(process.getuid()),
    '--gid',
    String(process.getgid()),
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--dir',
    '/tmp/home',
    '--ro-bind',
    '/usr',
    '/usr',
    '--symlink',
    'usr/bin',
    '/bin',
    '--symlink',
    'usr/sbin',
    '/sbin',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--ro-bind',
    path.join(passwdDir, 'passwd'),
    '/etc/passwd',
    '--ro-bind',
    path.join(passwdDir, 'group'),
    '/etc/group',
  ];
  if (network === 'egress') args.push('--ro-bind', resolvConf, '/etc/resolv.conf');
  for (const file of ETC_FILES) if (existing(file)) args.push('--ro-bind', file, file);
  args.push(
    '--ro-bind',
    NODE_ROOT,
    NODE_ROOT,
    '--ro-bind',
    path.join(REPO_ROOT, 'node_modules'),
    path.join(REPO_ROOT, 'node_modules'),
    '--ro-bind',
    EXPERIMENT_DIR,
    EXPERIMENT_DIR,
  );
  // The writable paths, both inside the per-run scratch folder. The suite copy is bound after the
  // read-only experiment folder, so it replaces the suite's own path.
  if (suiteCopy) args.push('--bind', suiteCopy, suiteDir);
  if (outDir) args.push('--bind', outDir, SANDBOX_OUT_DIR);
  return args;
}

/** Runs `fn(scratch)` with a fresh private scratch folder (passwd, resolv.conf, out/), then deletes it. */
async function withScratch(fn) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'exp-sandbox-'));
  try {
    writeFileSync(
      path.join(scratch, 'passwd'),
      `lab:x:${process.getuid()}:${process.getgid()}:lab:/tmp/home:/bin/bash\n`,
    );
    writeFileSync(path.join(scratch, 'group'), `lab:x:${process.getgid()}:\n`);
    writeFileSync(path.join(scratch, 'resolv.conf'), 'nameserver 169.254.1.1\n');
    mkdirSync(path.join(scratch, 'out'));
    return await fn(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Runs a command inside the sandbox, in a disposable copy of the suite folder, and returns
 * runProcess's result (stdout, stderr tails, exit). `withOut` mounts the scratch out/ folder at
 * /work-out and calls `afterRun(outDir)` before the scratch folder is deleted.
 */
export function runInSandbox({ suite, command, args, network, withOut = false, afterRun }) {
  // Defence in depth: the harness already refuses such a suite, and the copy must never carry a link.
  assertNoSymlinks(suite);
  return withScratch(async (scratch) => {
    const outDir = path.join(scratch, 'out');
    const suiteCopy = path.join(scratch, 'suite');
    cpSync(suite.cwd, suiteCopy, { recursive: true, verbatimSymlinks: true });
    const inner = [
      '/usr/bin/bwrap',
      ...bwrapArgs({
        network,
        passwdDir: scratch,
        resolvConf: path.join(scratch, 'resolv.conf'),
        outDir: withOut ? outDir : undefined,
        suiteCopy,
        suiteDir: suite.cwd,
      }),
      '--chdir',
      suite.cwd,
      command,
      ...args,
    ];
    const [bin, ...binArgs] = network === 'egress' ? [...PASTA, ...inner] : inner;
    const env = {
      PATH: `${path.join(NODE_ROOT, 'bin')}:/usr/bin`,
      HOME: '/tmp/home',
      LANG: 'C.UTF-8',
    };
    const outer = await runProcess(bin, binArgs, { env });
    return { ...outer, extra: afterRun ? afterRun(outDir, outer) : undefined };
  });
}

const isCount = (value) => value === null || (Number.isInteger(value) && value >= 0);

/**
 * Runs `sandbox-entry.mjs` for a suite inside the sandbox. `fault` is a number (stub started
 * inside) or null (no stub, `baseUrl` is used). The entry writes `report.json` (Playwright's JSON)
 * and `outcome.json` into /work-out; the host reads exactly those two names through
 * readSandboxFile (regular files only) and returns them, as `{ ...outcome, reportText }`.
 * Anything the suite put elsewhere in the scratch folder is ignored and then deleted.
 */
export async function runSandboxed(suite, { fault, port, baseUrl, extraArgs = [], network }) {
  const spec = {
    suiteId: suite.id,
    fault,
    port,
    baseUrl,
    extraArgs: [...extraArgs, '--output=/tmp/pw-output'],
  };
  const outer = await runInSandbox({
    suite,
    command: process.execPath,
    args: [ENTRY, JSON.stringify(spec)],
    network,
    withOut: true,
    afterRun: (outDir) => ({
      reportText: readSandboxFile(outDir, 'report.json'),
      outcomeText: readSandboxFile(outDir, 'outcome.json'),
    }),
  });
  let outcome;
  try {
    outcome = JSON.parse(outer.extra.outcomeText);
  } catch (error) {
    throw new Error(
      `The sandboxed run of suite ${suite.id} produced no result (exit ${outer.exitCode}): ${outer.stderrTail || outer.stdoutTail}`,
      { cause: error },
    );
  }
  // The suite can write this file, so only plain values of the expected types are accepted.
  const text = (value) => (typeof value === 'string' ? value.slice(-4000) : '');
  return {
    requests: isCount(outcome.requests) ? outcome.requests : null,
    exitCode: Number.isInteger(outcome.exitCode) ? outcome.exitCode : null,
    timedOut: outcome.timedOut === true,
    stdoutTail: text(outcome.stdoutTail),
    stderrTail: text(outcome.stderrTail),
    reportText: outer.extra.reportText,
  };
}
