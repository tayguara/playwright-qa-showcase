#!/usr/bin/env bash
# Replaces personal and local identifiers in the transcripts, in place, before they are published.
#
#   sanitize-transcripts.sh [dir-or-file]...     (default: ~/ai-tests-lab/transcripts)
#
# What is replaced, in this order (nothing else is touched):
#   the lab path (~/ai-tests-lab by default)          -> <lab>
#   its dashed form (claude's project folder names)   -> <lab-dir>
#   the home directory of the person running this     -> <home>
#   e-mail addresses (except noreply@anthropic.com
#     and lab@lab.invalid)                            -> <email>
#   the account's organization id (organizationUuid)  -> <organization-uuid>
#   the local user name (whole word)                  -> <user>
# The home path, the user name and the e-mail addresses come from the environment or from the
# files themselves; none is written in this script. Before a file is rewritten, the sha256 of the
# original is saved next to it as <file>.raw.sha256, so the unsanitised original can be identified.
# Run scan-secrets.sh afterwards.

set -euo pipefail

LAB_ROOT=${AI_TESTS_LAB:-$HOME/ai-tests-lab} # AI_TESTS_LAB is for testing these scripts only
[ "$#" -ge 1 ] || set -- "$LAB_ROOT/transcripts"

regex_escape() { printf '%s' "$1" | sed 's/[][\.*^$+?(){}|#]/\\&/g'; }
lab_re=$(regex_escape "$LAB_ROOT")
lab_dashed_re=$(regex_escape "$(printf '%s' "$LAB_ROOT" | tr '/' '-')")
home_re=$(regex_escape "$HOME")
user_re=$(regex_escape "$(id -un)")
email_re='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'

find "$@" -type f -name '*.jsonl' | sort | while IFS= read -r file; do
  tmp=$(mktemp)
  sed -E \
    -e "s#$lab_re#<lab>#g" \
    -e "s#$lab_dashed_re#<lab-dir>#g" \
    -e "s#$home_re#<home>#g" \
    -e 's#noreply@anthropic\.com#@@KEEP-1@@#g; s#lab@lab\.invalid#@@KEEP-2@@#g' \
    -e "s#$email_re#<email>#g" \
    -e 's#@@KEEP-1@@#noreply@anthropic.com#g; s#@@KEEP-2@@#lab@lab.invalid#g' \
    -e 's#("organizationUuid":")[^"]*#\1<organization-uuid>#g' \
    -e "s#\\b$user_re\\b#<user>#g" \
    "$file" > "$tmp"
  if cmp -s "$file" "$tmp"; then
    echo "nothing to rewrite in $file"
    rm -f "$tmp"
  else
    sha256sum < "$file" | cut -d' ' -f1 > "$file.raw.sha256"
    cat "$tmp" > "$file"
    rm -f "$tmp"
    echo "sanitized $file"
  fi
done
