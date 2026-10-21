import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { childEnv } from '../suites.mjs';

const args = { baseUrl: 'http://127.0.0.1:4010', rawPath: '/tmp/raw.json' };

describe('childEnv', () => {
  const parent = {
    PATH: '/usr/bin',
    HOME: '/home/someone',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TMPDIR: '/tmp',
    TERM: 'xterm',
    NODE_OPTIONS: '--no-warnings',
    NODE_PATH: '/np',
    NODE_EXTRA_CA_CERTS: '/ca.pem',
    NODE_USE_SYSTEM_CA: '1',
    NODE_AUTH_TOKEN: 'npm_secret',
    NODE_ENV: 'production',
    PLAYWRIGHT_BROWSERS_PATH: '/pw',
    CI: 'true',
    BOOKER_BASE_URL: 'https://elsewhere.example',
    BOOKER_TOKEN: 'abc',
    ANTHROPIC_API_KEY: 'sk-secret',
    GH_TOKEN: 'fake-github-token',
    AWS_SECRET_ACCESS_KEY: 'secret',
    SSH_AUTH_SOCK: '/run/agent',
  };

  test('passes on only the allowlisted variables', () => {
    const env = childEnv(args, parent);
    for (const name of [
      'PATH',
      'HOME',
      'LANG',
      'LC_ALL',
      'TMPDIR',
      'TERM',
      'NODE_OPTIONS',
      'NODE_PATH',
      'NODE_EXTRA_CA_CERTS',
      'NODE_USE_SYSTEM_CA',
    ]) {
      assert.equal(env[name], parent[name], name);
    }
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, '/pw');
  });

  test('drops secrets, CI and every inherited BOOKER_* variable', () => {
    const env = childEnv(args, parent);
    for (const name of [
      'ANTHROPIC_API_KEY',
      'GH_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'SSH_AUTH_SOCK',
      'CI',
    ]) {
      assert.equal(name in env, false, name);
    }
    assert.equal('BOOKER_TOKEN' in env, false);
  });

  test('sets the fixed values last', () => {
    const env = childEnv(args, { ...parent, FORCE_COLOR: '1', PLAYWRIGHT_JSON_OUTPUT_FILE: '/x' });
    assert.equal(env.BOOKER_BASE_URL, args.baseUrl);
    assert.equal(env.BOOKER_USERNAME, 'admin');
    assert.equal(env.BOOKER_PASSWORD, 'password123');
    assert.equal(env.PLAYWRIGHT_JSON_OUTPUT_FILE, args.rawPath);
    assert.equal(env.FORCE_COLOR, '0');
  });

  test('an empty parent environment still yields the fixed values only', () => {
    assert.deepEqual(Object.keys(childEnv(args, {})).sort(), [
      'BOOKER_BASE_URL',
      'BOOKER_PASSWORD',
      'BOOKER_USERNAME',
      'FORCE_COLOR',
      'PLAYWRIGHT_JSON_OUTPUT_FILE',
    ]);
  });
});
