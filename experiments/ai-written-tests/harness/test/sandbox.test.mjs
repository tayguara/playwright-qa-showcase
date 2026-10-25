import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import { PASTA, ROUTE_SCRIPT, bwrapArgs } from '../sandbox.mjs';
import { EXPERIMENT_DIR, REPO_ROOT, RESULTS_DIR, SANDBOX_OUT_DIR } from '../suites.mjs';

const NODE_ROOT = path.dirname(path.dirname(process.execPath));
const SUITE_DIR = path.join(EXPERIMENT_DIR, 'suite-a');
const base = {
  passwdDir: '/scratch',
  resolvConf: '/scratch/resolv.conf',
  outDir: '/scratch/out',
  suiteCopy: '/scratch/suite',
  suiteDir: SUITE_DIR,
};

/** Triples of [flag, source, destination] for the bind flags in an argument list. */
function binds(args) {
  const found = [];
  for (let i = 0; i < args.length; i++) {
    if (['--bind', '--ro-bind'].includes(args[i])) found.push([args[i], args[i + 1], args[i + 2]]);
  }
  return found;
}

describe('bwrapArgs', () => {
  test('the only writable binds are the per-run out folder and a disposable suite copy; never results/ or the real suite', () => {
    const list = binds(bwrapArgs({ ...base, network: 'none' }));
    assert.deepEqual(
      list.filter(([flag]) => flag === '--bind'),
      [
        ['--bind', '/scratch/suite', SUITE_DIR],
        ['--bind', '/scratch/out', SANDBOX_OUT_DIR],
      ],
    );
    for (const [flag, source] of list) {
      if (flag !== '--bind') continue;
      assert.equal(
        source.startsWith('/scratch/'),
        true,
        `${source} must be inside the scratch folder`,
      );
    }
    assert.equal(
      list.some(([flag, source]) => flag === '--bind' && source === RESULTS_DIR),
      false,
    );
    assert.equal(
      list.some(([flag, source]) => flag === '--bind' && source === SUITE_DIR),
      false,
    );
  });

  test('the suite copy is bound after the read-only experiment folder, so it replaces the suite path', () => {
    const list = binds(bwrapArgs({ ...base, network: 'none' }));
    const experiment = list.findIndex(([, source]) => source === EXPERIMENT_DIR);
    const copy = list.findIndex(([, source]) => source === '/scratch/suite');
    assert.ok(experiment >= 0 && copy > experiment);
  });

  test('without an outDir (lint) only the suite copy is writable', () => {
    const list = binds(bwrapArgs({ ...base, outDir: undefined, network: 'none' }));
    assert.deepEqual(
      list.filter(([flag]) => flag === '--bind'),
      [['--bind', '/scratch/suite', SUITE_DIR]],
    );
  });

  test('nothing from the host home is bound, and the repo root is not bound as a whole', () => {
    for (const [, source] of binds(bwrapArgs({ ...base, network: 'none' }))) {
      assert.notEqual(source, REPO_ROOT);
      // The node install (under ~/.nvm for nvm users) is the one allowed place in the home.
      if (source === NODE_ROOT) continue;
      assert.equal(
        source.startsWith(`${process.env.HOME}/.`),
        false,
        `${source} is a home dotfile`,
      );
    }
  });

  test('the experiment folder, and so results/, is read-only', () => {
    const list = binds(bwrapArgs({ ...base, network: 'none' }));
    const experiment = list.find(([, source]) => source === EXPERIMENT_DIR);
    assert.equal(experiment[0], '--ro-bind');
  });

  test('network none keeps the sandbox off the network; egress shares the pasta namespace', () => {
    assert.equal(bwrapArgs({ ...base, network: 'none' }).includes('--share-net'), false);
    assert.equal(bwrapArgs({ ...base, network: 'egress' }).includes('--share-net'), true);
  });

  test('DNS resolv.conf is bound only for egress', () => {
    const dests = (network) => binds(bwrapArgs({ ...base, network })).map(([, , dest]) => dest);
    assert.equal(dests('none').includes('/etc/resolv.conf'), false);
    assert.equal(dests('egress').includes('/etc/resolv.conf'), true);
  });

  test('hides any npmrc in the node install with a tmpfs over its etc/', () => {
    const args = bwrapArgs({ ...base, network: 'none' });
    const i = args.findIndex(
      (a, k) => a === '--tmpfs' && args[k + 1] === path.join(NODE_ROOT, 'etc'),
    );
    assert.ok(i > 0);
    const roBind = args.findIndex((a, k) => a === '--ro-bind' && args[k + 1] === NODE_ROOT);
    assert.ok(roBind >= 0 && roBind < i, 'the tmpfs comes after the node install bind');
  });

  test('always unshares everything and dies with its parent', () => {
    for (const network of ['none', 'egress']) {
      const args = bwrapArgs({ ...base, network });
      for (const flag of ['--unshare-all', '--die-with-parent', '--new-session']) {
        assert.ok(args.includes(flag), `${network}: ${flag}`);
      }
    }
  });
});

describe('pasta wrapper', () => {
  test('blocks the private ranges before it hands over to bwrap, and keeps 169.254.0.0/16', () => {
    for (const range of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10']) {
      assert.ok(ROUTE_SCRIPT.includes(range), range);
    }
    assert.ok(ROUTE_SCRIPT.includes('169.254.169.254/32'), 'cloud metadata address blocked');
    assert.equal(ROUTE_SCRIPT.includes('169.254.1.1'), false, 'DNS address stays reachable');
    assert.equal(ROUTE_SCRIPT.includes('169.254.0.0'), false);
    assert.ok(ROUTE_SCRIPT.endsWith('exec "$@"'));
    assert.ok(ROUTE_SCRIPT.startsWith('set -e;'), 'fails closed');
    assert.equal(ROUTE_SCRIPT.includes('|| true'), false);
    assert.equal(ROUTE_SCRIPT.includes('2>/dev/null'), false);
    assert.equal(ROUTE_SCRIPT.includes('ip -6'), false);
    assert.ok(ROUTE_SCRIPT.includes('/proc/sys/net/ipv6/conf/all/disable_ipv6'));
    assert.ok(ROUTE_SCRIPT.includes('/proc/sys/net/ipv6/conf/default/disable_ipv6'));
    assert.equal(PASTA.at(-2), ROUTE_SCRIPT);
  });

  test('has no port forwarding in either direction and does not map the gateway to the host', () => {
    const flags = PASTA.join(' ');
    assert.equal(PASTA[1], '-4', 'IPv4 only: no IPv6 inside the sandbox');
    for (const part of ['--no-map-gw', '-t none', '-u none', '-T none', '-U none']) {
      assert.ok(flags.includes(part), part);
    }
  });
});
