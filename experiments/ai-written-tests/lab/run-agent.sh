#!/usr/bin/env bash
# Runs ONE Claude Code session inside a bubblewrap sandbox, so that the only part of your home
# directory the agent can see (and the only part it can write) is its own lab folder plus a dedicated,
# empty Claude config directory.
#
#   run-agent.sh <suite-a|suite-b|canary-on|canary-off> [prompt-file]   run the session
#   run-agent.sh login                                                  log in once (interactive)
#   run-agent.sh sandbox-test                                           isolation self-test, no model
#   run-agent.sh canary-debug <prompt-file>                             diagnostics with a throwaway prompt
#
# The prompt is piped to `claude -p` on stdin. Defaults: prompts/agent-prompt.md for suite-a and
# suite-b, lab/canary-prompt.md for the canaries. One generation per suite: the script refuses to
# overwrite an existing transcript (no reruns; restart only for an infrastructure failure,
# which you document in prompts/run-manifest.json, after moving the old transcript away).
#
# What the sandbox contains (a tmpfs root, so everything else simply does not exist):
#   read-only   /usr (+ /bin /sbin /lib /lib64 symlinks), selected /etc files (TLS certificates,
#               DNS, hosts, a minimal fake passwd/group), the node install, the claude binary
#   read-write  ~/ai-tests-lab/<name> (the agent's project, also its HOME and cwd)
#               ~/ai-tests-lab/.claude-config (CLAUDE_CONFIG_DIR, login state)
#   private     /tmp, /var/tmp, /proc, /dev
#   network     its OWN network namespace through `pasta`: user-mode egress to the internet, but
#               no host loopback (so no Redis, Postgres, dashboards ... on 127.0.0.1) and no
#               route to the host through the gateway. LAN hosts remain reachable through egress.
# Not visible: the rest of your home directory (code folders, ~/.ssh, ~/.claude, ~/.config,
# ~/.npmrc ...), the repository, the shell environment.
#
# Runs are sequential: a lock refuses a second concurrent run, and the shared config directory is
# cleaned of sessions, memory and CLAUDE.md files before every run.
#
# Residual risk: the agent runs as the same user and can read the Claude login token that lives
# in .claude-config, and has open internet egress. See the README section "Isolation of the
# agent runs".

set -euo pipefail

LAB_ROOT=${AI_TESTS_LAB:-$HOME/ai-tests-lab} # AI_TESTS_LAB is for testing these scripts only
MODEL=claude-sonnet-5-5 # pinned, identical for A and B
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=copy-regular.sh
source "$HERE/copy-regular.sh"
REPO=$(cd "$HERE/../../.." && pwd)

usage() {
  sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

name=${1:-}
prompt=${2:-}
case "$name" in
  suite-a | suite-b | canary-on | canary-off | canary-debug | login | sandbox-test) ;;
  *) usage ;;
esac

die() {
  echo "run-agent: $*" >&2
  exit 1
}

# Where node and claude live on THIS machine, resolved at run time (symlinks followed).
NODE_BIN=$(command -v node) || die "node not found in PATH"
NODE_DIR=$(dirname "$(dirname "$(readlink -f "$NODE_BIN")")")
CLAUDE_LINK=$(command -v claude) || die "claude not found in PATH"
CLAUDE_TARGET=$(readlink -f "$CLAUDE_LINK")
CLAUDE_BIN_DIR=$(dirname "$CLAUDE_LINK")

command -v /usr/bin/bwrap > /dev/null || die "bubblewrap (/usr/bin/bwrap) is not installed"
command -v /usr/bin/pasta > /dev/null || die "pasta (/usr/bin/pasta) is not installed"
command -v flock > /dev/null || die "flock is not installed"
[ -d "$LAB_ROOT/.claude-config" ] || die "lab not set up: run lab/setup-lab.sh first"
[ -d "$NODE_DIR/bin" ] || die "node install not found at $NODE_DIR"
[ -f "$CLAUDE_TARGET" ] || die "claude binary $CLAUDE_TARGET not found"
case "$CLAUDE_TARGET" in
  "$LAB_ROOT"/* | "$REPO"/*) die "claude resolves to $CLAUDE_TARGET inside the lab or the repository" ;;
esac

workdir="$LAB_ROOT/$name"
case "$name" in login | sandbox-test) workdir="$LAB_ROOT/canary-off" ;; esac
[ -d "$workdir" ] || die "$workdir does not exist: run lab/setup-lab.sh first"

# Symmetry checks: only suite-b and canary-on may have a CLAUDE.md.
case "$name" in
  suite-a | canary-off | canary-debug | login | sandbox-test)
    [ ! -e "$workdir/CLAUDE.md" ] || die "$workdir/CLAUDE.md must not exist for $name"
    ;;
  suite-b | canary-on)
    [ -f "$workdir/CLAUDE.md" ] || die "$workdir/CLAUDE.md is missing for $name"
    ;;
esac
for forbidden in AGENTS.md .claude .mcp.json; do
  [ ! -e "$workdir/$forbidden" ] || die "unexpected $workdir/$forbidden"
done

if [ "$name" != login ] && [ "$name" != sandbox-test ]; then
  if [ -z "$prompt" ]; then
    case "$name" in
      suite-*) prompt="$REPO/experiments/ai-written-tests/prompts/agent-prompt.md" ;;
      *) prompt="$HERE/canary-prompt.md" ;;
    esac
  fi
  # The canary prompt names your real home directory (it asks the agent to look for it, and it
  # must not find it). That path ends up in the canary transcript: do not publish canary output.
  if [ "$prompt" = "$HERE/canary-prompt.md" ]; then
    canary_prompt=$(mktemp)
    sed "s#__HOST_HOME__#$HOME#g" "$prompt" > "$canary_prompt"
    prompt=$canary_prompt
  fi
  [ -f "$prompt" ] || die "prompt file $prompt not found"
  out="$LAB_ROOT/transcripts/$name.jsonl"
  [ ! -e "$out" ] || die "$out already exists (one generation per suite); move it away to restart"
fi

# One run at a time: the config directory is shared, so a concurrent run could read or write the
# other's session files.
if [ "$name" != sandbox-test ]; then
  exec 9> "$LAB_ROOT/.run.lock"
  flock -n 9 || die "another run holds $LAB_ROOT/.run.lock; runs are sequential"
fi

# Before every agent run, drop everything a previous session left in the config directory (session
# logs, memory, CLAUDE.md, skills ...). Only the login state and settings stay.
if [ "$name" != login ] && [ "$name" != sandbox-test ]; then
  cfg="$LAB_ROOT/.claude-config"
  [ -n "$LAB_ROOT" ] && [ -d "$cfg" ] || die "config directory $cfg missing"
  for leftover in projects todos shell-snapshots statsig plugins skills commands agents memory history.jsonl CLAUDE.md; do
    rm -rf -- "${cfg:?}/$leftover"
  done
  find "$cfg" \( -name CLAUDE.md -o -name MEMORY.md -o -name memory \) -exec rm -rf -- {} + 2> /dev/null || true
fi

# A minimal passwd/group so tools can resolve the uid without exposing the real account name.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp" "${canary_prompt:-}"' EXIT
printf 'lab:x:%s:%s:lab:%s:/bin/bash\n' "$(id -u)" "$(id -g)" "$workdir" > "$tmp/passwd"
printf 'lab:x:%s:\n' "$(id -g)" > "$tmp/group"

# DNS: pasta forwards queries sent to 169.254.1.1 to the host's resolver.
printf 'nameserver 169.254.1.1\n' > "$tmp/resolv.conf"

# Own network namespace with user-mode egress. -4: IPv4 only, so the namespace has no IPv6 address
# (the host's IPv6 link-local address would otherwise reach host services listening on [::]); the
# script also disables IPv6 in the namespace, because the kernel still gives the tap interface a
# link-local address of its own.
# -t/-u/-T/-U none: no port forwarding in either direction, so the host's loopback services are
# unreachable; --no-map-gw: the gateway address does not map back to the host. pasta forwards
# connections to the host's OTHER addresses (Docker bridges, VPN interfaces) as ordinary sockets,
# so before bwrap starts we add unreachable routes for the private ranges; the sandbox has no
# capability to remove them. The script fails closed: `set -e`, and exec only after every route
# was added. 169.254.0.0/16 stays (the DNS forward is 169.254.1.1). The on-link LAN subnet stays
# reachable (more specific route). Keep this script identical to ROUTE_SCRIPT in harness/sandbox.mjs.
route_script='set -e; echo 1 > /proc/sys/net/ipv6/conf/all/disable_ipv6; echo 1 > /proc/sys/net/ipv6/conf/default/disable_ipv6; for n in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10; do ip route add unreachable "$n"; done; exec "$@"'
net=(/usr/bin/pasta -4 --config-net --no-map-gw --dns-forward 169.254.1.1 -t none -u none -T none -U none -- /usr/bin/sh -c "$route_script" _)

bw=(
  # --share-net here means "stay in the pasta namespace we were started in".
  /usr/bin/bwrap --unshare-all --share-net --die-with-parent --uid "$(id -u)" --gid "$(id -g)"
  --proc /proc --dev /dev --tmpfs /tmp --tmpfs /var/tmp
  --ro-bind /usr /usr
  --symlink usr/bin /bin --symlink usr/sbin /sbin --symlink usr/lib /lib --symlink usr/lib64 /lib64
  --ro-bind "$tmp/passwd" /etc/passwd --ro-bind "$tmp/group" /etc/group
  --ro-bind "$tmp/resolv.conf" /etc/resolv.conf
)
for f in /etc/ssl /etc/pki /etc/crypto-policies /etc/hosts /etc/nsswitch.conf /etc/host.conf \
  /etc/ld.so.cache /etc/ld.so.conf /etc/ld.so.conf.d /etc/os-release; do
  [ -e "$f" ] && bw+=(--ro-bind "$f" "$f")
done
bw+=(
  --ro-bind "$NODE_DIR" "$NODE_DIR"
  --ro-bind "$CLAUDE_TARGET" "$CLAUDE_TARGET"
  --symlink "$CLAUDE_TARGET" "$CLAUDE_LINK"
  --bind "$workdir" "$workdir"
  --bind "$LAB_ROOT/.claude-config" "$LAB_ROOT/.claude-config"
  --chdir "$workdir"
  --unsetenv BOOKER_BASE_URL
)

# Only these variables exist inside. DISABLE_AUTOUPDATER keeps claude from writing to its own
# (read-only) install directory.
envs=(
  PATH="$NODE_DIR/bin:$CLAUDE_BIN_DIR:/usr/local/bin:/usr/bin"
  HOME="$workdir"
  LANG=C.UTF-8
  TERM="${TERM:-dumb}"
  CLAUDE_CONFIG_DIR="$LAB_ROOT/.claude-config"
  DISABLE_AUTOUPDATER=1
)

if [ "$name" = login ]; then
  echo "Inside the sandbox: run /login, finish the login, then /exit." >&2
  exec env -i "${envs[@]}" "${net[@]}" "${bw[@]}" claude --setting-sources project
fi

if [ "$name" = sandbox-test ]; then
  # Asserts the isolation (no model involved); exits non-zero if any check fails. Expected: Work,
  # .ssh and the real CLAUDE.md are missing, /usr is read-only, the lab is writable, the environment
  # is minimal, host loopback services and the LAN address are unreachable, the public ping is 201.
  # Every IPv4 address of the host (collected here, before entering the sandbox): none may let the
  # agent reach a host service. IPv6 is not probed address by address: the sandbox must not have
  # IPv6 at all (asserted inside).
  mapfile -t host_addrs < <(ip -4 -o addr 2> /dev/null | awk '{print $4}' | cut -d/ -f1 | sort -u)
  # First path component below $HOME of everything that is mounted from there.
  allowed=""
  for mounted in "$NODE_DIR" "$CLAUDE_TARGET" "$CLAUDE_LINK" "$LAB_ROOT" "$workdir"; do
    case "$mounted" in "$HOME"/*) rel=${mounted#"$HOME"/}; allowed="$allowed ${rel%%/*}" ;; esac
  done
  bw+=(--new-session)
  env -i "${envs[@]}" "${net[@]}" "${bw[@]}" bash -c '
    fail=0
    check() { # description, expected (ok|fail), command...
      local what=$1 want=$2; shift 2
      if "$@" > /dev/null 2>&1; then got=ok; else got=fail; fi
      if [ "$got" = "$want" ]; then echo "PASS $what"; else echo "FAIL $what"; fail=1; fi
    }
    reach() { timeout 3 bash -c "exec 3<>/dev/tcp/$1/$2"; }
    echo "HOME=$HOME  cwd=$(pwd)  user=$(id -un)"
    host_home=$1; allowed=$2; shift 2
    # The real home directory of the host: only the folders that hold the lab, node and claude may
    # exist inside (as mount points); everything else, .ssh and .claude included, must not.
    unexpected=""
    for entry in $(ls -A "$host_home" 2> /dev/null); do
      case " $allowed " in *" $entry "*) ;; *) unexpected="$unexpected $entry" ;; esac
    done
    if [ -z "$unexpected" ]; then echo "PASS the host home shows only the lab, node and claude folders"; else echo "FAIL the host home shows:$unexpected"; fail=1; fi
    check "the host ~/.ssh is not visible" fail test -e "$host_home/.ssh"
    check "the host ~/.claude is not visible" fail test -e "$host_home/.claude"
    check "/usr is read-only" fail touch /usr/x
    check "the lab folder is writable" ok touch "$HOME/writable"
    check "node runs" ok node --version
    check "claude runs" ok claude --version
    echo "env variable names: $(env | cut -d= -f1 | sort | tr "\n" " ")"
    node -e "require(\"net\").createServer().listen(6390, \"127.0.0.1\")" &
    sleep 1
    check "control: a listener started inside IS reachable on 127.0.0.1:6390" ok reach 127.0.0.1 6390
    kill %1 2> /dev/null
    for port in 6379 5432 80 24282; do
      check "host service 127.0.0.1:$port is unreachable" fail reach 127.0.0.1 "$port"
    done
    # $@ = every address of the host. Probe each on the usual service ports; any connect is a failure.
    probed=0; open=""
    for addr in "$@"; do
      for port in 6379 5432 80 15672 8084 24282; do
        probed=$((probed + 1))
        if timeout 2 bash -c "exec 3<>/dev/tcp/$addr/$port" 2> /dev/null; then open="$open $addr:$port"; fi
      done
    done
    if [ "$probed" -eq 0 ]; then echo "FAIL no host addresses were collected"; fail=1
    elif [ -n "$open" ]; then echo "FAIL reachable host services:$open"; fail=1
    else echo "PASS $# host addresses x 6 ports probed ($probed connections), none reachable"; fi
    # No IPv6 inside: no neighbour entries, and no interface except lo with an IPv6 address.
    check "no IPv6 neighbours are visible" ok test -z "$(ip -6 neigh 2> /dev/null)"
    ipv6_non_lo() { ip -6 -o addr 2> /dev/null | while read -r _ ifname _; do [ "$ifname" != lo ] && echo "$ifname"; done; }
    check "no interface other than lo has an IPv6 address" ok test -z "$(ipv6_non_lo)"
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 15 https://restful-booker.herokuapp.com/ping)
    if [ "$code" = 201 ]; then echo "PASS public ping answers 201"; else echo "FAIL public ping answered $code"; fail=1; fi
    exit $fail
  ' _ "$HOME" "$allowed" "${host_addrs[@]}"
  exit $?
fi

# Inherited file descriptors do not survive pasta on SELinux hosts. pasta runs in its own confined
# domain (pasta_t on Fedora); at the exec into that domain the kernel replaces every inherited
# descriptor the domain may not use with /dev/null, and files under the home directory are such
# files, while /tmp files are not. An output file in the lab (stdout and stderr) therefore stays
# empty (exit status 0, session fine) and a prompt file in the repository would arrive as an EMPTY
# stdin. So no descriptor to a home file is passed: the prompt is copied into a private /tmp folder
# bound read-only at /run-in, and claude's stdin, stdout and stderr are redirected INSIDE the
# sandbox to files in a /tmp folder bound read-write at /run-out; the host copies them into the
# lab's transcripts folder after the run. (The agent can see /run-out while it runs; the session
# log that claude keeps in the config directory is copied too, as a second record.)
mkdir -p "$tmp/in" "$tmp/out"
cp "$prompt" "$tmp/in/prompt.md"
sha256sum < "$tmp/in/prompt.md" | cut -d' ' -f1 > "$LAB_ROOT/transcripts/$name.prompt.sha256"
bw+=(--ro-bind "$tmp/in" /run-in --bind "$tmp/out" /run-out --new-session)
echo "run-agent: $name, model $MODEL, prompt $prompt" >&2
date -u +%FT%TZ > "$LAB_ROOT/transcripts/$name.started"
set +e
env -i "${envs[@]}" "${net[@]}" "${bw[@]}" /usr/bin/sh -c 'exec "$@" < /run-in/prompt.md > /run-out/transcript.jsonl 2> /run-out/stderr.txt' _ \
  claude -p \
  --model "$MODEL" \
  --setting-sources project \
  --strict-mcp-config --disable-slash-commands \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash,WebFetch(domain:restful-booker.herokuapp.com),WebFetch(domain:playwright.dev)" \
  --disallowedTools "Bash(npm install*)" "Bash(npm i *)" "Bash(npm uninstall*)" "Bash(npm ci*)" "Bash(yarn*)" "Bash(pnpm*)" "Read(/$REPO/**)" \
  --output-format stream-json --verbose
status=$?
set -e
date -u +%FT%TZ > "$LAB_ROOT/transcripts/$name.ended"
echo "$status" > "$LAB_ROOT/transcripts/$name.exit"

# Copy the outputs out of the scratch folder (the host writes them; nothing inherited from the lab).
# Only regular, non-symlink files are copied: the agent can write /run-out, so it could plant a
# symlink to a host file or a FIFO there.
copy_regular "$tmp/out/transcript.jsonl" "$out"
copy_regular "$tmp/out/stderr.txt" "$LAB_ROOT/transcripts/$name.stderr.txt"
[ -s "$out" ] || echo "run-agent: WARNING: the stream-json transcript is empty; use the session copy" >&2

# Second record: claude's own session log(s). The config directory was cleaned before the run, so
# every file under projects/ belongs to this run. Existing copies are never overwritten.
n=0
session_root="$LAB_ROOT/.claude-config/projects"
[ ! -L "$session_root" ] || echo "run-agent: WARNING: $session_root is a symlink; session logs are not copied" >&2
while IFS= read -r session; do
  target="$LAB_ROOT/transcripts/$name.session.jsonl"
  [ "$n" -eq 0 ] || target="$LAB_ROOT/transcripts/$name.session.$n.jsonl"
  [ -e "$target" ] || install -m 600 "$session" "$target"
  n=$((n + 1))
done < <([ -L "$session_root" ] || find "$session_root" -name '*.jsonl' -type f 2> /dev/null | sort)
[ "$n" -gt 0 ] || echo "run-agent: WARNING: no session log found under the config directory" >&2
echo "run-agent: $name finished with exit status $status; transcript $out ($(wc -c < "$out") bytes), $n session log(s)" >&2
exit "$status"
