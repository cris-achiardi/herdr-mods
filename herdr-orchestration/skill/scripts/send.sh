#!/usr/bin/env bash
# send.sh <terminal> <text...>
# hc send, then make sure the turn actually started. Codex in particular often keeps the pasted
# text in its input box (send returns "started":false); one Enter submits it. An extra Enter on an
# already-submitted Codex/Claude input is a no-op, so this never double-sends the text.
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: send.sh <terminal> <text...>" >&2; exit 2; }
t=$1; shift; text="$*"
r=$(hc send --json "$t" "$text"); echo "$r"
case "$r" in *'"started":true'*) exit 0 ;; esac
sleep 3
state=$(hc get "$t" --json | grep -o '"state":"[a-z]*"}' | tail -1 || true)
case "$state" in *working*) echo "[$t] started late: $state"; exit 0 ;; esac
echo "[$t] not started ($state); screen tail:"; hc read "$t" --lines 0 | grep -v '^[[:space:]]*$' | tail -4
hc keys "$t" enter
sleep 3
state=$(hc get "$t" --json | grep -o '"state":"[a-z]*"}' | tail -1 || true)
echo "[$t] after Enter: $state"
case "$state" in *working*) exit 0 ;; *) echo "[$t] still not working; read the pane before doing anything else" >&2; exit 1 ;; esac
