#!/usr/bin/env bash
# Copies one finished suite from the lab into the repository, verbatim, and proves it.
#
#   copy-suite.sh <suite-a|suite-b>
#
# Steps: refuse a suite that contains symbolic links; copy with `rsync -rt --no-links` and without
# node_modules, .git, .npm (npm's debug logs hold lab paths), test-results, playwright-report,
# blob-report and .claude; write the manifest
# (`find ... -type f | sort | xargs sha256sum`, paths relative to the suite folder) next to the lab
# copy; copy it to experiments/ai-written-tests/<suite>.sha256; verify the repository copy with
# `sha256sum -c`. It never runs git in the lab (the agent controls the lab repository's config)
# and never executes anything from the suite. Read every copied file yourself before you run the
# harness on it. The script refuses to overwrite an existing copy: it is immutable after the runs.

set -euo pipefail

LAB_ROOT=${AI_TESTS_LAB:-$HOME/ai-tests-lab}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EXP=$(cd "$HERE/.." && pwd)

die() {
  echo "copy-suite: $*" >&2
  exit 1
}

name=${1:-}
case "$name" in
  suite-a | suite-b) ;;
  *)
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
    exit 2
    ;;
esac
command -v rsync > /dev/null || die "rsync is not installed"

src="$LAB_ROOT/$name"
dest="$EXP/$name"
manifest_lab="$LAB_ROOT/$name.sha256"
manifest_repo="$EXP/$name.sha256"
[ -d "$src" ] || die "$src does not exist"
[ ! -e "$dest" ] && [ ! -e "$manifest_repo" ] || die "$dest or $manifest_repo already exists; the copy is immutable"

# A symlink can point the analysers at host files (for example under ~/.ssh).
links=$(find "$src" \( -name node_modules -o -name .git -o -name .npm \) -prune -o -type l -print)
[ -z "$links" ] || die "the suite contains symbolic links, refusing to copy: $links"

excludes=(--exclude node_modules --exclude .git --exclude test-results --exclude playwright-report --exclude blob-report --exclude .claude --exclude .npm)
rsync -rt --no-links "${excludes[@]}" "$src/" "$dest/"

# Manifest from the lab copy, with the same exclusions; paths relative to the suite folder.
(
  cd "$src"
  find . \( -name node_modules -o -name .git -o -name test-results -o -name playwright-report \
    -o -name blob-report -o -name .claude -o -name .npm \) -prune -o -type f -print0 | sort -z | xargs -0 sha256sum
) > "$manifest_lab"
cp "$manifest_lab" "$manifest_repo"

# Verify the repository copy against the manifest, and that it holds no extra file.
(cd "$dest" && sha256sum -c "$manifest_repo" > /dev/null) || die "verification failed for $dest"
listed=$(wc -l < "$manifest_repo")
present=$(find "$dest" -type f | wc -l)
[ "$listed" -eq "$present" ] || die "$dest has $present files but the manifest lists $listed"
echo "copy-suite: $name copied and verified ($listed files); manifest $manifest_repo"
