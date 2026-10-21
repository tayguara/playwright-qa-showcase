// Process helpers: start/stop the stub, and run a child command without a shell.

import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const STUB_ENTRY = fileURLToPath(new URL('../stub/server.mjs', import.meta.url));
const HEALTH_POLL_MS = 100;
const HEALTH_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;
const OUTPUT_TAIL_CHARS = 4_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects when something already listens on 127.0.0.1:port. */
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use; stop the other process or pass --port`)
          : error,
      );
    });
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

async function readHealth(url) {
  const response = await fetch(`${url}/__stub/health`, { signal: AbortSignal.timeout(2_000) });
  return response.json();
}

function waitForExit(child, ms) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Runs `fn(url)` against a fresh stub process.
 * Steps: fail fast if the port is taken, spawn `node stub/server.mjs`, poll /__stub/health,
 * run `fn`, read the request count, then SIGTERM the stub and wait for it to exit.
 * Returns `{ result, requests }`.
 */
export async function withStub({ fault = 0, port = 4010 } = {}, fn) {
  await assertPortFree(port);

  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [STUB_ENTRY], {
    env: { ...process.env, FAULT: String(fault), STUB_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const earlyExit = new Promise((_, reject) => {
    child.once('exit', (code, signal) => {
      reject(new Error(`Stub exited early (code ${code}, signal ${signal}): ${output.trim()}`));
    });
  });
  earlyExit.catch(() => {}); // handled below, only while we still wait for it

  try {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    for (;;) {
      try {
        await readHealth(url);
        break;
      } catch (error) {
        if (child.exitCode !== null || child.signalCode !== null) await earlyExit;
        if (Date.now() > deadline) {
          throw new Error(`Stub did not answer /__stub/health within 10 s: ${error.message}`, {
            cause: error,
          });
        }
        await sleep(HEALTH_POLL_MS);
      }
    }

    const result = await fn(url);
    const { requests } = await readHealth(url);
    return { result, requests };
  } finally {
    child.kill('SIGTERM');
    if (!(await waitForExit(child, STOP_TIMEOUT_MS))) {
      child.kill('SIGKILL');
      await waitForExit(child, STOP_TIMEOUT_MS);
    }
  }
}

/**
 * Runs a command with fixed argv (never through a shell) and resolves with its exit status and
 * the tail of its output. A run that exceeds `timeoutMs` is killed and flagged `timedOut`.
 */
export function runProcess(command, args, { cwd, env, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        stdout,
        stdoutTail: stdout.slice(-OUTPUT_TAIL_CHARS),
        stderrTail: stderr.slice(-OUTPUT_TAIL_CHARS),
      });
    });
  });
}
