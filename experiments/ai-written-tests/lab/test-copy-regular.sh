#!/usr/bin/env bash
# Seeded test for copy_regular (no model, no sandbox): a regular file is copied; a symlink to a
# readable file, a symlink to a directory, a dangling symlink, a FIFO, a directory and a missing
# file are all refused with an empty destination and a warning, and none of them hangs.
#
#   test-copy-regular.sh      exit 0 when every case behaves as expected

set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=copy-regular.sh
source "$HERE/copy-regular.sh"

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
fail=0
secret="$scratch/host-secret.txt"
echo "HOST-SECRET" > "$secret"

expect_refused() { # name, src
  local name=$1 src=$2 dest="$scratch/out-$1"
  timeout 10 bash -c 'source "$1"; copy_regular "$2" "$3"' _ "$HERE/copy-regular.sh" "$src" "$dest" 2> "$scratch/warn-$name"
  local rc=$?
  if [ "$rc" -eq 124 ]; then echo "FAIL $name: copy hung"; fail=1
  elif [ ! -e "$dest" ] || [ -s "$dest" ]; then echo "FAIL $name: destination is not an empty file"; fail=1
  elif ! grep -q WARNING "$scratch/warn-$name"; then echo "FAIL $name: no warning"; fail=1
  else echo "PASS $name refused"; fi
}

# Regular file: copied.
echo "real transcript" > "$scratch/regular.jsonl"
copy_regular "$scratch/regular.jsonl" "$scratch/out-regular"
if [ "$(cat "$scratch/out-regular")" = "real transcript" ]; then echo "PASS regular file copied"; else echo "FAIL regular file"; fail=1; fi

ln -s "$secret" "$scratch/link-file.jsonl"
ln -s "$scratch" "$scratch/link-dir.jsonl"
ln -s "$scratch/nowhere" "$scratch/dangling.jsonl"
mkfifo "$scratch/fifo.jsonl"
mkdir "$scratch/dir.jsonl"
expect_refused symlink-to-file "$scratch/link-file.jsonl"
expect_refused symlink-to-dir "$scratch/link-dir.jsonl"
expect_refused dangling-symlink "$scratch/dangling.jsonl"
expect_refused fifo "$scratch/fifo.jsonl"
expect_refused directory "$scratch/dir.jsonl"
expect_refused missing "$scratch/missing.jsonl"

if grep -rq HOST-SECRET "$scratch"/out-symlink-to-file; then echo "FAIL the host secret was copied"; fail=1; else echo "PASS the host secret was not copied"; fi
exit "$fail"
