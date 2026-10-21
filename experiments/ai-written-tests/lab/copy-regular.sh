# Sourced by run-agent.sh (and by test-copy-regular.sh); not run on its own.
#
# copy_regular SRC DEST copies a file the sandbox could write, but only if it is a regular file and
# not a symlink. Anything else (missing, a symlink to a host file, a FIFO that would hang cp, a
# directory, a device) gives an EMPTY DEST and a warning on stderr. The sandbox is gone by the time
# this runs, so nothing can swap the file between the test and the copy.
copy_regular() {
  local src=$1 dest=$2
  if [ -f "$src" ] && [ ! -L "$src" ]; then
    cp -- "$src" "$dest"
  else
    : > "$dest"
    echo "run-agent: WARNING: $(basename -- "$src") is missing or not a regular file; wrote an empty $(basename -- "$dest")" >&2
  fi
}
