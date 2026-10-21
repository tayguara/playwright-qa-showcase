#!/usr/bin/env bash
# Flags transcript lines that suggest the agent looked at suite H or at this repository.
#
#   audit-transcripts.sh <transcript-or-dir>...
#
# Suite H lives in tests/api on the main branch of a public repository, and the sandbox cannot
# stop an agent from fetching it: the only detection is this audit. It prints rule: file:line:
# match for every hit and exits 1 if there is any (2 on a usage error or a missing path). A hit is
# a question for a human, not proof: a legitimate fetch of a library's own repository page also
# matches the GitHub rules. Read the surrounding transcript lines before deciding.
#
# Rules: GitHub hosts and URLs (github.com/, raw.githubusercontent, codeload.github,
# api.github.com), the repository name, H's client class name, the repository path on THIS machine
# (derived from the script location), and package installs (`npm install` / `npm i` / `npm ci`).

set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)

if [ "$#" -lt 1 ]; then
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
fi
for path in "$@"; do
  [ -e "$path" ] || {
    echo "audit-transcripts: $path does not exist" >&2
    exit 2
  }
done

regex_escape() { printf '%s' "$1" | sed 's/[][\.*^$+?(){}|]/\\&/g'; }

status=0
PATHS=("$@")
audit_paths() { # rule, regex (searches the paths given to the script)
  local rule=$1 regex=$2 out rc
  out=$(grep -rnoaHiE --exclude-dir=node_modules --exclude-dir=.git -e "$regex" -- "${PATHS[@]}")
  rc=$?
  [ "$rc" -le 1 ] || {
    echo "audit-transcripts: grep failed for rule $rule" >&2
    exit 2
  }
  if [ -n "$out" ]; then
    while IFS= read -r line; do printf '%s: %s\n' "$rule" "${line:0:240}"; done <<< "$out"
    status=1
  fi
}

audit_paths github-host 'github\.com/|raw\.githubusercontent|codeload\.github|api\.github\.com'
audit_paths repo-name 'playwright-qa-showcase'
audit_paths h-client 'BookingClient'
audit_paths repo-path "$(regex_escape "$REPO")"
audit_paths npm-install 'npm (install|i|ci)\b'

if [ "$status" -ne 0 ]; then
  echo "audit-transcripts: hits found (see above); review each one in context before publishing" >&2
fi
exit "$status"
