# AI-written Playwright API tests: experiment

This folder holds an experiment that measures how good Playwright API tests are when an AI coding agent writes them, with and without a short guardrails file. Every number in the related article comes from the files in `results/`.

Status: **pre-registered** once the git tag `exp-ai-tests-prereg` exists; it must be created before any agent runs and this file must not change after it. The protocol below was fixed before any agent ran. If this text and the tag disagree, the tag wins. Limitations and bias are in the last section; read them before the numbers.

## What is compared

Three suites test the same seven Restful Booker behaviours:

1. Authentication (`POST /auth`).
2. Creating a booking and reading it back.
3. Finding a booking by first and last name.
4. Updating a booking with `PUT` (full replacement).
5. Partially updating a booking with `PATCH`.
6. A `PUT` without a token is rejected with 403 and changes nothing.
7. Deleting a booking: `DELETE` answers 201 and the booking is gone.

| Suite | Source                                         | Written by                                                                                                          |
| ----- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **H** | `tests/api` in this repo (A1 to A8), unchanged | the repository author, who knew the API                                                                             |
| **A** | `suite-a/`                                     | an AI coding agent, given only [`prompts/agent-prompt.md`](prompts/agent-prompt.md)                                 |
| **B** | `suite-b/`                                     | the same agent, prompt and scaffold, plus [`prompts/guardrails.md`](prompts/guardrails.md) installed as `CLAUDE.md` |

A and B start from the identical scaffold in `prompts/scaffold/` (pinned dependency versions, no config, no tests). There is one generation per arm. No reruns, no human edits.

## The instrument: a local stub with 10 faults

`stub/server.mjs` is a small in-memory imitation of the public sandbox, built on `node:http` with zero dependencies. It binds to `127.0.0.1` only. Its clean behaviour follows a dated probe of the real API, recorded with every command and response in [`stub/FIDELITY.md`](stub/FIDELITY.md), which also lists the known gaps.

One fault is active at a time (`FAULT=<n>`, `0` or unset is clean). A suite "catches" a fault when it fails with the fault on although it passed on the clean stub.

| #   | Slug                           | Behaviour when active                                                                |
| --- | ------------------------------ | ------------------------------------------------------------------------------------ |
| 1   | `get-wrong-totalprice`         | `GET /booking/:id` returns the stored `totalprice` plus 1                            |
| 2   | `get-omits-additionalneeds`    | `GET /booking/:id` leaves out `additionalneeds`                                      |
| 3   | `patch-changes-unsent-fields`  | `PATCH` resets every top-level field missing from the body (`bookingdates` excepted) |
| 4   | `put-without-token-accepted`   | `PUT` skips the auth check; `PATCH` and `DELETE` still enforce it                    |
| 5   | `delete-not-deleting`          | an authorised `DELETE` answers 201 but the booking stays                             |
| 6   | `name-filter-ignored`          | `GET /booking` ignores `firstname` and `lastname`                                    |
| 7   | `auth-accepts-any-credentials` | `POST /auth` hands out a valid token for any or missing credentials                  |
| 8   | `dates-swapped-on-read`        | `GET /booking/:id` returns `checkin` and `checkout` swapped                          |
| 9   | `depositpaid-as-string`        | every booking in a response has `depositpaid` as `"true"` or `"false"`               |
| 10  | `every-5th-request-500`        | every 5th request since the process started answers 500 with no side effect          |

Fault semantics are frozen. The stub may change after pre-registration only to match a real-API behaviour shown in a new dated entry in `FIDELITY.md`. Every results file records `stubSha256`, and any stub change invalidates all stub results, so all three suites must be rerun.

## Pre-registered prediction for suite H

Written from a static reading of `tests/api`, before the experiment's own runs:

- H catches faults 1, 2, 3, 4, 5, 7, 8, 9 and 10.
- H misses fault 6, because test A4 only asserts `toContain(id)` and never checks that other bookings are excluded.
- Expected headline for H: **9 of 10**.

The run decides. This prediction is not a pass criterion.

**This prediction is not a blind test of H.** It was written in the planning document before the stub and harness existed (that document is not published: the first public trace of the prediction is the tag), but the suite-H results on the stub were also seen during development (development checks), before the tag exists. The tag cannot prove that the prediction came before those H runs. The pre-registration therefore covers the protocol, the faults and the two AI arms (A and B), whose agent runs happen after the tag, and not a blind confirmation for H.

## Metrics (computed only from `results/`)

| Metric                        | Source                     | Definition                                                                                          |
| ----------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| Tests                         | `stub.clean.total`         | Playwright test executions; the summary also shows unique titles                                    |
| Pass rate, clean stub         | `stub.clean.passRate`      | passed / (total - skipped)                                                                          |
| Pass rate, public API         | `public.passRate`          | one run, timestamp recorded                                                                         |
| **Faults caught** (headline)  | `stub.faultsCaught`        | 0 to 10. `invalid` (the stub saw no request) counts as not caught                                   |
| Faults surfaced only as flaky | `stub.faults[].flakyTests` | informational                                                                                       |
| Lint violations               | `lint`                     | errors + warnings with the showcase rules, measured and not enforced; fatal errors shown separately |
| Weak assertions               | `weak-assertions.json`     | hits, and tests with at least one hit / total, per the checklist below                              |
| Flaky over 5 repeats          | `repeat.flakyTests`        | tests with mixed outcomes across 5 repetitions on one clean stub                                    |
| Type errors (supplementary)   | `typecheck.errors`         | `tsc --noEmit` error count, labelled supplementary                                                  |

**Caught**, precisely: at least one test that passed on the clean baseline fails with the fault on, or the run has a global error the baseline did not have. A failing test with no key in the baseline also counts and is flagged. Tests that already failed on the baseline never count. `flaky` results (failed, then passed on a retry) are recorded but not counted. A suite's own retries are respected, not overridden.

**Weak-assertion checklist (version 1, fixed).** Applied per test; assertions in fixtures or helpers that a test uses count for that test; each item hits at most once per test.

- W1 Status-only.
- W2 Existence or partial matchers where the exact value is known.
- W3 No read-back after a mutation.
- W4 No contract or type validation.
- W5 Inclusion-only search.
- W6 Negative path without a state check.
- W7 Lenient status.
- W8 Assertions that may not run or are swallowed.

The full wording is in [`prompts/weak-assertion-review-prompt.md`](prompts/weak-assertion-review-prompt.md). Two raters apply it: the author by hand, and an LLM second rater. The LLM rater is pre-registered like this: it runs once per suite, with the pinned model `claude-sonnet-5-5`, no tools, the review prompt as its only instruction, in a fresh session, and its output is JSON only; it sees one suite at a time, labelled X, Y or Z, and the author draws and records the label-to-suite mapping before the run. It runs in the same isolated lab approach as the agents (same sandbox and minimal environment as the agents; the rater has no tools, so the open egress of that sandbox is not used), with the suite source as input, because the suite is untrusted text. Both counts, their agreement and the reconciled count are reported.

## What the tag freezes

1. **Frozen by the tag.**
   - This README and everything in `prompts/` (agent prompt, guardrails, review prompt, scaffold).
   - `stub/` (clean contract, faults, `stubSha256`), under the change rule in the instrument section.
   - The metric definitions: `harness/analyze.mjs`, the suite commands and flags in `harness/suites.mjs`, the measure ESLint config, and checklist v1.
   - The agent run parameters in `lab/run-agent.sh`: the model id, `--setting-sources project`, `--strict-mcp-config`, `--disable-slash-commands`, the allow-list and deny-list, the minimal environment, the visible filesystem of the sandbox and the pasta network policy.
2. **May still be fixed after the tag, for infrastructure reasons only** (the other harness files, `guard.mjs` and `sandbox-entry.mjs`, are infrastructure too; `lint-count.mjs` defines the lint and type-error counts and is a metric file, frozen like `analyze.mjs`): `lab/setup-lab.sh`, `lab/sanitize-transcripts.sh`, `lab/scan-secrets.sh`, `lab/scan-allow.txt`, `lab/copy-suite.sh`, `lab/audit-transcripts.sh`, the sandbox plumbing of `lab/run-agent.sh` and `harness/sandbox.mjs` (mount paths, binary locations, route script, retries, error handling), and `harness/run.mjs`, `harness/report.mjs` and `harness/stub-process.mjs` (crashes, output paths). Conditions: the change must not alter anything listed in point 1; it must not be made after A or B results have been seen (a crash before any metric is produced is not a result, so fixing it is allowed); each change is disclosed; and the sha256 of every lab and harness script actually used is recorded in `prompts/run-manifest.json`. `stub/*.mjs` may change only under the stub change rule.
3. **Immutable once the agents have run:** the transcripts, `suite-a/` and `suite-b/`, and their sha256 manifests.
4. **`results/` today holds suite-H development runs** that were seen before the tag. The official sequence overwrites them.

## Run procedure (frozen)

1. Pre-registration commit and tag `exp-ai-tests-prereg`: this README, prompts, scaffold, review prompt, stub, harness and lab scripts. The branch is not pushed until the agent runs are done.
2. A lab outside the repository, created by [`lab/setup-lab.sh`](lab/setup-lab.sh) in `~/ai-tests-lab` (override with `AI_TESTS_LAB`): `suite-a` and `suite-b`, each a copy of the scaffold with `npm ci`, committed in its own git repo with a neutral identity. B gets `guardrails.md` as `CLAUDE.md`, checked by `sha256`. A dedicated, empty Claude config directory (`.claude-config`) is created for the login.
3. A canary (not part of the experiment), run with [`lab/canary-prompt.md`](lab/canary-prompt.md) in `canary-on` and `canary-off`. It shows that a `CLAUDE.md` in the folder is loaded, that nothing from the user's own configuration, memory or skills is, and that the sandbox hides the rest of your real home directory, `~/.ssh` and the real `~/.claude/CLAUDE.md` (the canary prompt gets your home path substituted at run time, so canary transcripts contain it and must not be published), passes only a minimal environment, and still reaches the sandbox API (`/ping` answers 201). `lab/run-agent.sh sandbox-test` checks the isolation without a model.
4. Both agents run through [`lab/run-agent.sh`](lab/run-agent.sh), with the same command, the same pinned model (`claude-sonnet-5-5`), `--setting-sources project`, `--strict-mcp-config`, `--disable-slash-commands`, a tool allow-list and a deny-list, inside a bubblewrap sandbox (see "Isolation of the agent runs"). `--bare` is not used: the runs use a subscription login in the dedicated config directory, not an API key. They run one after the other, A first and then B, and the order is recorded in `prompts/run-manifest.json` (the config directory is shared; `run-agent.sh` takes a lock, refuses a concurrent run, and clears sessions, memory and `CLAUDE.md` files from the config directory before each run). Timestamps are recorded next to the transcripts.
5. One generation per suite (`run-agent.sh` refuses to overwrite a transcript). A restart from a fresh scaffold is allowed only for an infrastructure failure (CLI crash, API outage, rate limit before completion) and is documented in `prompts/run-manifest.json`.
6. Audit and copy, per suite:
   - `lab/audit-transcripts.sh` flags transcript lines matching these patterns: GitHub hosts, the repository name, H's client class, this repository's path and package installs. It does not cover mirrors or other hosts except through the repository-name and client-class rules. Every hit is read in context. This repository is public, so suite H is readable on its main branch, and the sandbox cannot stop an agent from fetching it: this audit is the only detection.
   - `lab/sanitize-transcripts.sh` replaces the lab path with `<lab>` in every `*.jsonl` (the stream-json transcript and the session copy; the sha256 of each raw file is kept). The committed transcripts are otherwise unedited (apart from what an agent could have altered in the two records, see the SELinux note).
   - `lab/scan-secrets.sh` scans the transcripts (the stream-json files AND the `*.session.jsonl` copies) and the suite folders and must exit 0 before anything is committed.
   - A person reads every file of each suite (configuration, `package.json`, helpers, anything that executes) before the harness runs it.
   - Git commands in a lab folder use `git -c core.fsmonitor=false -c core.pager=cat -c core.hooksPath=/dev/null --no-pager ...` (or `.git/config` is read first), because the agent controls that file and some keys execute commands. The git log is saved to `prompts/transcripts/suite-x.gitlog.txt`.
   - `lab/copy-suite.sh suite-a` (and `suite-b`) refuses a suite that contains symbolic links, copies it with `rsync -rt --no-links` without `.git`, `node_modules`, `test-results`, `playwright-report`, `blob-report` and `.claude`, writes the manifest in the lab (`find ... -type f | sort | xargs sha256sum`), copies it to `suite-x.sha256` and verifies the repository copy with `sha256sum -c`.

**Adaptation rule.** A copied suite is adapted only if its clean in-repo run is `invalid` (the stub saw no request) or it cannot start because of environment differences (for example a hardcoded URL or a missing package). Allowed: the smallest change that honours `BOOKER_BASE_URL` or resolves a module. Never test logic or assertions. Every change is a unified diff in `results/adaptations.md` (it says "none" when nothing changed), and the article must disclose it. The harness runs a disposable copy of the suite folder, so a suite that writes into its own folder (for example a token cache under `.auth/`) works as it did in the lab; such writes are not a reason to adapt.

## Isolation of the agent runs

The agents are untrusted: they read data that anyone can write into the public sandbox, so a prompt injected there could steer them, and the `WebFetch` allow-list is not an egress control (`Bash` can reach any host). Isolation therefore comes from the operating system, not from tool rules (an earlier draft relied on `--bare` and a `Read` deny rule, which did not stop `Bash`).

- `lab/run-agent.sh` starts `claude -p` inside `bwrap` (`--unshare-all --die-with-parent --new-session`, on a tmpfs root), itself started by `pasta`, which gives the sandbox its own network namespace. The only parts of your home directory that exist inside are the agent's own folder (`~/ai-tests-lab/<name>`, also its `HOME` and working directory, writable), the dedicated config directory `~/ai-tests-lab/.claude-config` (writable, exported as `CLAUDE_CONFIG_DIR`), and read-only copies of the node install and the claude binary, both located at run time (`command -v node`, `command -v claude`, symlinks followed). `/usr` and a few `/etc` files (TLS certificates, DNS, hosts, a fake passwd without the real account name) are read-only. `/tmp`, `/var/tmp`, `/proc` and `/dev` are private.
- The process starts from `env -i` and receives only `PATH`, `HOME`, `LANG`, `TERM`, `CLAUDE_CONFIG_DIR` and `DISABLE_AUTOUPDATER`. No API key, token or shell variable is passed.
- The network is a separate namespace with IPv4-only user-mode egress (`pasta -4 --config-net --no-map-gw`, no port forwarding in either direction, DNS forwarded to the host resolver). IPv6 is off (`-4`, and the route step also disables it in the namespace) because the host's IPv6 link-local address would otherwise reach host services listening on all interfaces. `pasta` also forwards connections to the host's other IPv4 addresses (Docker bridges, VPN interfaces) as ordinary sockets, so before bwrap starts, unreachable routes are added for `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` and `100.64.0.0/10` (the sandbox has no capability to remove them; `169.254.0.0/16` stays because the DNS forward lives there, so the host's own link-local addresses are not routed away; `sandbox-test` probes every host IPv4 address, link-local ones included). The route step fails closed: if one route cannot be added, the sandbox does not start. The host's loopback services, its own addresses on those private ranges, IPv6 and abstract unix sockets are NOT reachable from inside. `run-agent.sh sandbox-test` asserts this: it takes every IPv4 address from `ip -o addr` on the host and tries each on ports 6379, 5432, 80, 15672, 8084 and 24282, and fails if any connects (a control proves the probe can connect); it fails if the sandbox has IPv6 neighbours or any non-loopback interface with an IPv6 address; and it checks that `/ping` answers 201. Egress to the internet is open; the `WebFetch` allow-list is not an egress control. Reachable from inside: the internet, and the machines of the host's on-link LAN subnet (a more specific route than the blocked `/16`).
- **SELinux note (found in a real session).** On Fedora, `pasta` runs in its own confined SELinux domain, and at the exec into it the kernel replaces every inherited file descriptor the domain may not use (files under the home directory) with `/dev/null`. A transcript file in the lab then stays empty although the run succeeds, and a prompt file in the repository would arrive as an empty stdin. `run-agent.sh` therefore passes no descriptor to a home file: the prompt is copied into a private `/tmp` folder (bound read-only at `/run-in`), claude's stdin, stdout and stderr are redirected inside the sandbox to files in another `/tmp` folder (bound read-write at `/run-out`), and the host copies them to the lab's `transcripts/` folder afterwards, only when each is a regular file and not a symlink (`lab/copy-regular.sh`, with a seeded test in `lab/test-copy-regular.sh`; a planted symlink or FIFO gives an empty file and a warning) (`<name>.jsonl`, `<name>.stderr.txt`, and `<name>.prompt.sha256` for the prompt actually sent). The agent can see AND write `/run-out` while it runs, and the config directory that holds the session log is writable too, so neither record is tamper-proof; the two records and the prompt hash allow a comparison. As a second record, claude's own session log is copied from the config directory to `<name>.session.jsonl` right after each run, before the next run's cleanup. On a host without SELinux this changes nothing.
- The config directory holds no `CLAUDE.md`, skills, plugins or MCP configuration, and `--setting-sources project` keeps user-level settings out. The canary checks this.
- The tool allow-list and deny-list stay as a second layer. They are not the isolation. The package-manager deny rules can be bypassed (`npx`, extra spaces), which is harmless inside the sandbox.

**Residual risk.** The agent runs as the same Unix user (as a mapped user inside the sandbox) and can read its own Claude login token inside `.claude-config`. Egress is open: a prompt injected through the public sandbox's data could make the agent send that token, or anything else it can read (its own lab folder), to any internet host, and it can still reach machines on the host's on-link LAN subnet (for example the router) and public addresses of any other network. It cannot reach the host's own services on the probed ports, other private ranges, IPv6, the repository, `~/.ssh` or the shell environment. Mitigations: the config directory is dedicated and holds nothing else; log that session out or revoke it in the account settings right after the runs; do not reuse the login for anything else. As defence in depth, the operator also stops host services that listen on all interfaces (Redis, Postgres, RabbitMQ, Docker containers, local HTTP apps) for the two agent sessions and the A/B public run. The sandbox does not protect against a kernel, bubblewrap or pasta vulnerability.

**Audit.** `lab/audit-transcripts.sh` is described in the run procedure (it is the detection for access to suite H). `lab/scan-secrets.sh` (no dependencies; rules for Anthropic keys and tokens, GitHub and AWS tokens, private keys, Slack tokens, password literals other than exactly `password123`, e-mail addresses, and the home path and user name of whoever runs the scan, read from the environment). An optional private pattern file outside the repository (`$SCAN_PRIVATE_PATTERNS`, default `~/.config/ai-tests-lab/private-patterns.txt`, one regular expression per line, ignored if missing) can add personal terms such as your username, e-mail or employer. The script and `lab/scan-allow.txt` are not scanned when found by their own path. It must exit 0 on the transcripts, the copied suites and `results/` before they are committed; it exits 2 if a path is missing. It reports only the matched text, so a harmless string on the same transcript line cannot hide a secret. Reviewed false positives go into `lab/scan-allow.txt` as exact matched texts. It also runs `-a` (binary files, even with a NUL byte, are scanned as text) and always prints the file name, so a single file operand works. Before the final commit it is run over the transcripts, `suite-a/`, `suite-b/` AND `results/` (the lint evidence copies source lines and the raw reports copy test output, so a secret in a suite can end up there). The scan looks for what is known to be sensitive; it is not a guarantee.

## How A and B run inside this repo

They keep their own `package.json`, lock file, Playwright config and `tsconfig.json` exactly as the agent left them, and are not installed. The scaffold pins the same versions as the root `package.json`, so imports resolve upward to the root `node_modules` and there is a single `@playwright/test` instance. The harness runs `node <repo>/node_modules/@playwright/test/cli.js test ...` with the suite folder as the working directory. It never uses `npx` there, because `npx` could try to download tools.

**Suites A and B run in a sandbox, suite H does not.** A and B are code an AI wrote, so every harness run of them (`faults`, `repeat`, `public` and `lint`) goes through `bwrap` (see `harness/sandbox.mjs`): `/usr` and the node install read-only, the repo's `node_modules` and the experiment folder (so also `results/`) read-only, a private `/tmp` that also serves as `HOME` (Playwright's own output goes there through `--output=/tmp/pw-output`), and two writable paths, both in a fresh per-run scratch folder: `/work-out`, and a disposable COPY of the suite folder mounted over the suite's own path (the real suite folder is never writable, and the copy is thrown away after the run). The repository root, `~/.ssh`, `~/.config` and the shell environment are absent. `results/` is deliberately not writable from inside: the suite's Playwright report and the run outcome are written to `/work-out/report.json` and `/work-out/outcome.json`, the host reads exactly those two names after the sandbox has exited (it refuses anything that is not a regular file, so a planted symlink is rejected), and the host itself writes the evidence into `results/`. In `faults`, `repeat` and `lint` the sandbox has no network beyond loopback (the stub runs inside the same sandbox); in `public` it gets the same `pasta` egress and private-range blocks as the agent runs. `lint` (ESLint with the measure config and `tsc --noEmit --pretty false`) also runs inside it, so the analysers cannot read host files through the suite. Every A/B run first refuses a suite folder that contains a symbolic link. A/B runs use `LANG=C.UTF-8` and UTC, while suite H runs with the host's locale and timezone; the fixed booking dates make an effect unlikely, but it is a difference. Text from the suites that is shown in `results/summary.md` (test titles, rule names) is escaped onto a single line, and the labels shown come from constants, not from results files. Suite H is the author's own code, reviewed by the author, and runs directly on the host with the restricted environment. The `unshare -rn` wrapper in the reproduction steps still applies to the harness as a whole.

Every Playwright run of a suite gets an environment built from an allowlist: `PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR`, `TERM`, `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA` and `PLAYWRIGHT_*` from the parent, plus `BOOKER_BASE_URL`, `BOOKER_USERNAME=admin`, `BOOKER_PASSWORD=password123` (the sandbox's public demo credentials), `PLAYWRIGHT_JSON_OUTPUT_FILE` and `FORCE_COLOR=0`. Secrets in the parent shell never reach the AI-written suites. The stub process and the analysers of suite H (trusted code) use the parent environment. Only workers (`--workers=1`) and the reporter (JSON) are overridden. Raw reports are rewritten with the absolute repo path replaced by `<repo>` and the home directory by `<home>`.

## Reproduce the results

Reproducing the stub-based numbers (faults, repeat, lint, type checks) does **not** need a Claude account, an API key or network access: the generated suites are committed in `suite-a/` and `suite-b/`, and the stub is local. The public-API pass rate (step 4 below) needs network access to the real sandbox and is a single-day snapshot, so a reproduction can legitimately give a different number.

Requirements: Node 22 and `npm ci` at the repository root. Reproducing suites A and B also needs Linux, bubblewrap at `/usr/bin/bwrap` and unprivileged user namespaces; the public run additionally needs `/usr/bin/pasta`. Suite H alone needs neither. There is no unsandboxed mode for A and B, on purpose. The offline step needs Linux with `unshare` (user and network namespaces); if it is not permitted, run the same commands without the wrapper. The harness records `"offline": false` in `results/environment.json` in that case.

```bash
# 1. Unit and contract tests of the stub and the harness
npm run exp:stub:test

# 2. Fault runs and repeat runs, offline so a hardcoded public URL fails visibly
unshare -rn sh -c 'ip link set lo up && npm run exp:faults && npm run exp:repeat'

# 3. Lint and type checks of all suites (measured, not enforced)
npm run exp:lint

# 4. One run against the real public sandbox (needs network; a snapshot of that day, not reproducible)
npm run exp:public

# 5. Render results/summary.md
npm run exp:summary
```

The harness uses port 4010 by default (`--port` changes it) and starts a fresh stub process for every run. It skips a suite whose folder does not exist yet, so a suite-H-only run works before the agent suites are added:

```bash
node experiments/ai-written-tests/harness/run.mjs faults --suite H
```

Manual use of the stub:

```bash
FAULT=3 STUB_PORT=4010 npm run exp:stub
BOOKER_BASE_URL=http://127.0.0.1:4010 npx playwright test --project=api --workers=1
```

Faults runs are official only when every fault ran in a single invocation (`"complete": true`). `--faults 0,3,10` is for debugging and marks the file `"complete": false`.

To **regenerate** suites A and B (optional, and the results will not match, since agent output varies from run to run) you need your own Claude account and the Claude Code CLI, and `bwrap` for the isolation. Run `lab/setup-lab.sh`, `lab/run-agent.sh login`, the canaries and then the suites, as described in the run procedure above. The scripts derive the lab location (`~/ai-tests-lab`), the node install and the claude binary at run time.

## Folder map

```
README.md                  this file
stub/                      the stub (server, store, faults), FIDELITY.md and its tests
lab/                       setup-lab.sh, run-agent.sh (bubblewrap + pasta sandbox), canary-prompt.md, audit-transcripts.sh, scan-secrets.sh, sanitize-transcripts.sh, copy-suite.sh, copy-regular.sh (+ its test)
harness/                   run.mjs (CLI), suites, analyze, report, stub-process, measure ESLint config and tests
prompts/                   agent prompt, guardrails, review prompt, scaffold, run manifest and transcripts
suite-a/  suite-b/         the agents' projects, verbatim
suite-a.sha256 suite-b.sha256   manifests proving the copies are verbatim
results/                   environment.json, suite-{h,a,b}.json, raw/, lint/, weak-assertions.*, adaptations.md, summary.md
```

The prompt files are byte-identical to the pre-registered text: the root Prettier and ESLint configs ignore `prompts/`, and the SHA-256 of `agent-prompt.md` and `guardrails.md` is recorded in `prompts/run-manifest.json`. Each file is the text of its code block plus one final newline.

## Honesty notes and limitations

- **One generation per arm (N = 1).** LLM output varies between runs. This experiment shows what one run produced, not a rate. There is no cherry-picking, and the transcripts are committed, unedited except that the lab path is replaced by `<lab>`.
- **Bias.** H was written by someone who knew the API, and the same person designed the faults, so the faults are not a neutral sample of "bugs an API can have" and H has the advantage of its author's knowledge. The agents developed their tests against the real public sandbox, which is not the stub. Four more points, all stemming from the same fact (one author wrote the tests, the faults, the guardrails and the checklist):
  1. Guardrails 2, 3 and 5 (assert on bodies and side effects, validate contracts with a schema, cover negative and authorization paths) map directly onto fault classes (faults 1, 2, 3, 8 and 9 corrupt bodies and contracts, faults 4, 5 and 7 are about side effects and auth). The weak-assertion checklist, written by the same author, has items (W3, W4, W6) that mirror those rules. B is partly rewarded for obeying rules that also define the scoring.
  2. Every fault corrupts data or authorization in a successful flow. None changes status codes, validation errors, 404 or 405 handling, or content types. A suite with broad negative-path coverage gets no extra credit on the headline metric.
  3. Fault 10 fails almost any suite that makes at least five requests and does not retry, whatever the quality of its assertions (a 500 on a request whose status is never asserted, such as a cleanup `DELETE` that ignores it, does not fail a test). It barely discriminates, so about one of the ten points is close to guaranteed.
  4. The lint metric uses the showcase's own rules, which A and B were never told about; guardrail 1 (no hard waits) maps onto a measured lint rule, and guardrail 6 tells B to run ESLint while A gets no such instruction. Also, the two agent runs are sequential, A first and then B, which is recorded in the manifest, so an order effect cannot be excluded.
- **The stub is not the real API.** It follows the probe in `FIDELITY.md` and lists known gaps there (for example XML responses, the real API's id handling quirks, and token behaviour). A suite can fail on the clean stub for a reason that has nothing to do with its quality. The clean pass rate and the adaptation rule exist to expose that.
- **The probe changed the clean contract.** The real API differs from the plain reading of its documentation in ways that matter to the stub, and the stub follows what was observed. `FIDELITY.md` records each one in the table "How the stub differs from the clean contract"; the ones that decide whether A and B pass on the clean stub are:
  - the `Accept` check is an exact match, and an absent or empty `Accept` header gets 418 (Playwright and Node's `fetch` send `*/*` by default, which passes);
  - the check runs after a change has been applied, so a rejected POST or PUT still stores data, and PATCH answers 500 (not 418) when the check fails;
  - `Accept: application/xml` works on the real API (200), while the stub answers 501: a documented fidelity gap;
  - PATCH replaces `bookingdates` as a whole, and the `checkin` filter matches strictly after the given date.
    A clean-stub failure of A or B caused by one of these is a stub-versus-real-API difference, not necessarily poor quality; the adaptation rule and the clean pass rate expose it.
- **The prompt for behaviours 6 and 7** ("changes nothing", "the booking is gone") hints at the state checks that faults 4 and 5 need. It is part of the frozen behaviour list, identical for A and B, and disclosed here.
- **A suite's own retries can hide fault 10.** Retries are respected by design and reported as "surfaced only as flaky". Fault 10 runs twice to show whether the outcome repeats.
- **The LLM rater is the same model that wrote A and B**, so self-preference is possible; the author's hand count is the check.
- **Weak-assertion review is partly blinded at best.** H's style is recognisable, and B's "regression" comments identify it. The LLM rater only sees a suite label.
- **The public-sandbox run** is one run per suite at one moment. The sandbox is shared and is reset periodically, so its result can vary between days.
- **Agent environment.** The agents run in a bubblewrap sandbox (see "Isolation of the agent runs") that shows them only their own lab folder, with a minimal environment, outside the repository, and with the branch unpushed. They have open network access (the internet, not only the model API, the public sandbox and its documentation), so egress is open, and the residual token risk described above remains. This repository is public, so suite H is readable on its main branch; the sandbox cannot prevent an agent from fetching it, and the only detection is the transcript audit (`lab/audit-transcripts.sh`).
- **The public sandbox is a moving target.** It is a shared test service that resets itself periodically and is written to by anyone, so even the agents' own runs against it can see data they did not create, and a probe or test can find its data gone.
- **Security review.** The stub and the harness were reviewed: the stub binds to `127.0.0.1`, runs on demand, keeps no persistence, uses only the public demo credentials and adds no dependencies, and the harness spawns fixed argv without a shell. The review found that the original agent-run procedure had no operating-system isolation and that the harness passed its whole environment to the AI-written suites. Both were fixed (sandboxed runs, environment allowlist, secret scan), and the residual token risk is stated above.

## Related files

- [`stub/FIDELITY.md`](stub/FIDELITY.md): the dated probe log and known gaps
- [`prompts/agent-prompt.md`](prompts/agent-prompt.md), [`prompts/guardrails.md`](prompts/guardrails.md): the exact prompt and the guardrails
- `results/summary.md`: generated, never edited by hand
- `docs/KNOWN_ISSUES.md` in the repo root: the earlier notes on the sandbox's quirks
