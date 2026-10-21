#!/usr/bin/env bash
# Creates the lab OUTSIDE the repository, in ~/ai-tests-lab:
#   suite-a, suite-b   scaffold copies with `npm ci`, one git commit each; suite-b also gets
#                      prompts/guardrails.md as CLAUDE.md (sha256 verified), in a second commit
#   canary-on          CLAUDE.md with the canary instruction
#   canary-off         empty
#   transcripts        stream-json output and timestamps written by run-agent.sh
#   .claude-config     dedicated CLAUDE_CONFIG_DIR (log in once with `run-agent.sh login`)
# Run it once, before the pre-registered agent runs. It refuses to touch an existing lab.

set -euo pipefail

LAB_ROOT=${AI_TESTS_LAB:-$HOME/ai-tests-lab} # AI_TESTS_LAB is for testing these scripts only
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EXP=$(cd "$HERE/.." && pwd)
SCAFFOLD="$EXP/prompts/scaffold"
GUARDRAILS="$EXP/prompts/guardrails.md"

die() {
  echo "setup-lab: $*" >&2
  exit 1
}

[ ! -e "$LAB_ROOT" ] || die "$LAB_ROOT already exists; remove it yourself if you want a fresh lab"
[ -d "$SCAFFOLD" ] && [ -f "$GUARDRAILS" ] || die "scaffold or guardrails.md not found under $EXP/prompts"
REPO=$(cd "$EXP/../.." && pwd)
case "$LAB_ROOT/" in "$REPO"/*) die "the lab must be outside the repository ($REPO)" ;; esac

mkdir -p "$LAB_ROOT"/{suite-a,suite-b,canary-on,canary-off,transcripts}
mkdir -m 700 "$LAB_ROOT/.claude-config"

# Commits in the lab use a neutral identity so no personal name or e-mail reaches the git log.
lab_git() { git -c user.name=lab -c user.email=lab@lab.invalid "$@"; }

for suite in suite-a suite-b; do
  dir="$LAB_ROOT/$suite"
  cp -a "$SCAFFOLD/." "$dir/"
  (
    cd "$dir"
    # Scripts are off: the scaffold needs none, and nothing from the registry should run here.
    npm ci --ignore-scripts --no-audit --no-fund
    git init -q -b main
    git add -A
    lab_git commit -q -m scaffold
  )
done

# B's only difference: the guardrails file, byte-identical.
cp "$GUARDRAILS" "$LAB_ROOT/suite-b/CLAUDE.md"
expected=$(sha256sum < "$GUARDRAILS" | cut -d' ' -f1)
actual=$(sha256sum < "$LAB_ROOT/suite-b/CLAUDE.md" | cut -d' ' -f1)
[ "$expected" = "$actual" ] || die "CLAUDE.md in suite-b does not match guardrails.md"
(
  cd "$LAB_ROOT/suite-b"
  git add CLAUDE.md
  lab_git commit -q -m "add guardrails"
)
echo "suite-b/CLAUDE.md sha256: $actual"

printf 'When asked for the canary word, answer PELICAN-42.\n' > "$LAB_ROOT/canary-on/CLAUDE.md"

# Scaffold hash for prompts/run-manifest.json (the files before npm ci and git).
(cd "$SCAFFOLD" && find . -type f | sort | xargs sha256sum | sha256sum | cut -d' ' -f1) \
  > "$LAB_ROOT/transcripts/scaffold.sha256"

echo "Lab ready in $LAB_ROOT. Next: lab/run-agent.sh login, then the canaries, then the suites."
