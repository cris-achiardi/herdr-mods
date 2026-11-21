#!/usr/bin/env bash
# spawn.sh <role> <name> <cwd> <task...>
# Start a visible agent from a herdr-core template, in a split pane of the CALLER's tab.
# Reads the template (frontmatter `command`, body = rules) itself and launches the program
# directly, because `hc run <template>` spawns through `sh`, which hc cannot find on Windows
# (spawn_failed: cannot start "sh"). Rules stay in one place: the template file.
set -euo pipefail
[ $# -ge 4 ] || { echo "usage: spawn.sh <worker|reviewer|...> <name> <cwd> <task...>" >&2; exit 2; }
role=$1 name=$2 cwd=$3; shift 3; task="$*"
me=${HC_TERMINAL_ID:?"not inside a Herdr terminal (HC_TERMINAL_ID unset)"}

if [ -n "${HERDR_TEMPLATES:-}" ]; then dir=$HERDR_TEMPLATES
elif [ -n "${APPDATA:-}" ] && [ -d "$APPDATA/herdr-core/templates" ]; then dir="$APPDATA/herdr-core/templates"
else dir="$HOME/.config/herdr-core/templates"; fi
f="$dir/$role.md"
[ -f "$f" ] || { echo "no template: $f  (hc templates lists what exists)" >&2; exit 2; }

cmd=$(awk '/^---[[:space:]]*$/{n++; next} n==1 && /^command:/{sub(/^command:[ \t]*/,""); print; exit}' "$f")
body=$(awk '/^---[[:space:]]*$/{n++; next} n>=2' "$f")
[ -n "$cmd" ] || { echo "template has no command: $f" >&2; exit 2; }
read -r -a argv <<< "$cmd"
case "${argv[0]}" in codex*) [[ " ${argv[*]} " == *" --no-daemon "* ]] || argv+=(--no-daemon) ;; esac

json=$(hc get "$me" --json)
space=$(printf '%s' "$json" | grep -o '"herdr.space":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
tab=$(printf '%s' "$json" | grep -o '"herdr.tab":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
labels=()
if [ -n "$space" ] && [ -n "$tab" ]; then labels=(--label "herdr.space=$space" --label "herdr.tab=$tab")
else echo "warning: no herdr.space/herdr.tab label on $me; the agent gets no visible pane" >&2; fi

prompt="$body

Your parent (report here with hc send): $me

Task:
$task"
hc run --bg --json --name "$name" --cwd "$cwd" "${labels[@]}" "${argv[@]}" "$prompt"
echo
# Startup dialogs (MCP trust, folder trust) block silently. Show where it is after a moment.
sleep 8
state=$(hc get "$name" --json | grep -o '"state":"[a-z]*"}' | tail -1 || true)
echo "[$name] $state"
case "$state" in
  *blocked*|*idle*) echo "[$name] may be on a startup dialog. Read it: hc read $name --lines 0" >&2 ;;
esac
