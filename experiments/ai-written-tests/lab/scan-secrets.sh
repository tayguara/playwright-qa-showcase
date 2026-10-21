#!/usr/bin/env bash
# Pattern scan for secrets and personal data, to run BEFORE committing transcripts or copied suites.
#
#   scan-secrets.sh <path>...
#
# Prints rule: file:line: match for every hit and exits 1 if there is any (2 on a usage or grep
# error, including a path that does not exist, so a typo can never look clean). No dependencies
# beyond grep (-a: binary files, even with a NUL byte, are scanned as text; -H: the file name is
# always printed, also for a single file operand).
#
# Rules: Anthropic keys and tokens, GitHub tokens, AWS key ids, private key blocks, Slack tokens,
# access/refresh token keys, a `password` assigned a string other than exactly password123 (also
# with JSON-escaped quotes), e-mail addresses, and, read from the environment of the person
# running the scan, their home directory path and user name (the lab path must first be rewritten
# to <lab> with sanitize-transcripts.sh). An optional private pattern file can add personal terms
# such as your own user name, e-mail address or employer, one extended regular expression per
# line (case-insensitive; # comments and blank lines ignored). Its location is
# $SCAN_PRIVATE_PATTERNS, default ~/.config/ai-tests-lab/private-patterns.txt, and it lives
# outside the repository on purpose; it is ignored when missing.
#
# Only the matched text is looked at, never the rest of the line: a stream-json line is a whole
# message, so a harmless string on the same line must not hide a secret. Tokens are matched whole
# (prefix plus the characters that follow), so an allowlist entry never covers a real token. A
# reviewed false positive is allowed by adding the EXACT matched text, one per line, to
# lab/scan-allow.txt (# comments allowed). This script and scan-allow.txt are not scanned when
# they are found by their own real path.

set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ALLOW="$HERE/scan-allow.txt"
SELF=$(realpath -- "${BASH_SOURCE[0]}")
ALLOW_REAL=$(realpath -- "$ALLOW" 2> /dev/null || echo "$ALLOW")
PRIVATE_PATTERNS=${SCAN_PRIVATE_PATTERNS:-$HOME/.config/ai-tests-lab/private-patterns.txt}

if [ "$#" -lt 1 ]; then
  sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
fi
for path in "$@"; do
  [ -e "$path" ] || {
    echo "scan-secrets: $path does not exist" >&2
    exit 2
  }
done

out=$(mktemp)
trap 'rm -f "$out"' EXIT

is_allowed() { # exact match against the allowlist
  [ -s "$ALLOW" ] && grep -vE '^(#|[[:space:]]*$)' "$ALLOW" | grep -Fxq -- "$1"
}

regex_escape() { printf '%s' "$1" | sed 's/[][\.*^$+?(){}|]/\\&/g'; }

status=0
scan_paths() { # rule, grep flags, regex (searches the paths given to the script)
  local rule=$1 flags=$2 regex=$3 file rest line match rc
  grep "$flags" --null --exclude-dir=node_modules --exclude-dir=.git -e "$regex" -- "${PATHS[@]}" > "$out"
  rc=$?
  if [ "$rc" -gt 1 ]; then
    echo "scan-secrets: grep failed (status $rc) for rule $rule" >&2
    exit 2
  fi
  while IFS= read -r -d '' file && IFS= read -r rest; do
    case "$(basename -- "$file")" in
      scan-secrets.sh | scan-allow.txt)
        real=$(realpath -- "$file" 2> /dev/null || echo "$file")
        [ "$real" = "$SELF" ] || [ "$real" = "$ALLOW_REAL" ] && continue
        ;;
    esac
    line=${rest%%:*}
    match=${rest#*:}
    is_allowed "$match" && continue
    if [ "$rule" = password ] && [[ $match =~ [:=][[:space:]]*\\?[\"\']?password123\\?[\"\']?$ ]]; then
      continue
    fi
    printf '%s: %s:%s: %s\n' "$rule" "$file" "$line" "${match:0:200}"
    status=1
  done < "$out"
}
PATHS=("$@")

scan_paths anthropic -rnoaiHE 'sk-ant[A-Za-z0-9_-]*'
scan_paths github-token -rnoaHE '(ghp_|github_pat_|gho_)[A-Za-z0-9_]*'
scan_paths aws-key -rnoaHE 'AKIA[A-Z0-9]*'
scan_paths private-key -rnoaHE '-----BEGIN[A-Z ]*'
scan_paths slack-token -rnoaHE 'xox[bp]-[A-Za-z0-9-]*'
scan_paths oauth-token -rnoaiHE '(access|refresh)_?token\\?"?[[:space:]]*[:=]'
scan_paths email -rnoaHE '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
# The home directory and user name of whoever runs the scan, read from the environment.
if [ -n "${HOME:-}" ] && [ "$HOME" != / ]; then
  scan_paths home-path -rnoaHE "$(regex_escape "$HOME")"
fi
user=$(id -un 2> /dev/null || true)
if [ -n "$user" ]; then
  scan_paths username -rnoaiHE "\\b$(regex_escape "$user")\\b"
fi
# Optional private patterns, outside the repository.
if [ -r "$PRIVATE_PATTERNS" ]; then
  while IFS= read -r pattern; do
    case "$pattern" in '' | '#'*) continue ;; esac
    scan_paths private -rnoaiHE "$pattern"
  done < "$PRIVATE_PATTERNS"
fi
# password assigned a quoted string (plain or JSON-escaped quotes), or shell style PASSWORD=value.
scan_paths password -rnoaiHE "password\\\\?[\"']?[[:space:]]*[:=][[:space:]]*\\\\?[\"'][^\"'\\\\]+\\\\?[\"']"
scan_paths password -rnoaiHE 'password=[^[:space:]"'"'"'\\`,;)]+'

if [ "$status" -ne 0 ]; then
  echo "scan-secrets: hits found (see above); fix them or review and allow the exact text in $ALLOW" >&2
fi
exit "$status"
