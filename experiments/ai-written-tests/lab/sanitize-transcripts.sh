#!/usr/bin/env bash
# Rewrites the lab path (~/ai-tests-lab by default) to <lab> in the stream-json transcripts, in place.
#
#   sanitize-transcripts.sh [dir-or-file]...     (default: ~/ai-tests-lab/transcripts)
#
# Before rewriting a file, its sha256 is saved next to it as <file>.raw.sha256 so that the
# unsanitised original can still be identified. Run scan-secrets.sh afterwards.

set -euo pipefail

LAB_ROOT=${AI_TESTS_LAB:-$HOME/ai-tests-lab} # AI_TESTS_LAB is for testing these scripts only
[ "$#" -ge 1 ] || set -- "$LAB_ROOT/transcripts"

find "$@" -type f -name '*.jsonl' | sort | while IFS= read -r file; do
  if grep -q "$LAB_ROOT" "$file"; then
    sha256sum < "$file" | cut -d' ' -f1 > "$file.raw.sha256"
    sed -i "s#$LAB_ROOT#<lab>#g" "$file"
    echo "sanitized $file"
  else
    echo "nothing to rewrite in $file"
  fi
done
