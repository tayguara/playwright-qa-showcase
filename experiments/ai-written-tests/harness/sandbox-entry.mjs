// Runs INSIDE the bubblewrap sandbox (see sandbox.mjs): optionally starts the stub, runs the
// suite's Playwright command, and writes the outcome as JSON to /work-out/outcome.json (a file,
// because `pasta` loses a child's stdout when it is a socket). The Playwright report goes to
// /work-out/report.json. Not a public CLI.
//
//   node sandbox-entry.mjs '<json>'   json = { suiteId, fault, port, baseUrl, extraArgs }
//
// fault = null means "no stub": the suite talks to baseUrl (the public sandbox, over pasta).

import { writeFileSync } from 'node:fs';
import { runProcess, withStub } from './stub-process.mjs';
import { SANDBOX_OUT_DIR, SUITES, childEnv, playwrightCommand } from './suites.mjs';

const spec = JSON.parse(process.argv[2] ?? '{}');
const suite = SUITES[spec.suiteId];
if (!suite || suite.id === 'H') {
  throw new Error(`The sandbox runs suites A and B only, got ${spec.suiteId}`);
}
if (!Array.isArray(spec.extraArgs) || !spec.extraArgs.every((arg) => typeof arg === 'string')) {
  throw new Error('extraArgs must be a list of strings');
}
const reportPath = `${SANDBOX_OUT_DIR}/report.json`;

const runPlaywright = (baseUrl) => {
  const { command, args, cwd } = playwrightCommand(suite, spec.extraArgs);
  // Shorter than the 10-minute limit of the outer sandbox, so a hung suite is reported as timed out
  // by this entry (with an outcome) instead of being killed from outside without one.
  return runProcess(command, args, {
    cwd,
    env: childEnv({ baseUrl, rawPath: reportPath }),
    timeoutMs: 9 * 60 * 1000,
  });
};

let run;
let requests = null;
if (spec.fault === null) {
  run = await runPlaywright(spec.baseUrl);
} else {
  ({ result: run, requests } = await withStub(
    { fault: spec.fault, port: spec.port },
    runPlaywright,
  ));
}

const { exitCode, timedOut, stdoutTail, stderrTail } = run;
writeFileSync(
  `${SANDBOX_OUT_DIR}/outcome.json`,
  JSON.stringify({ requests, exitCode, timedOut, stdoutTail, stderrTail }),
);
