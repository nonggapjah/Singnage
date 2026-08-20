#!/usr/bin/env bash
# PreToolUse(Edit|Write) — enforce No-Code-Before-Ticket (CLAUDE.md §4).
# A source-code edit requires at least one ticket in Development/ marked
# "[~] IN PROGRESS". Documentation, planning, logs and tickets themselves
# are never gated (that would deadlock: you could not write the ticket).
#
# Exit 0 = allow. Exit 2 = block, stderr is fed back to Claude.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_json.sh
. "$DIR/_json.sh"

REPO="$(cd "$DIR/../.." && pwd)"
PAYLOAD="$(cat)"
FILE="$(json_field "$PAYLOAD" '.tool_input.file_path')"

[ -z "$FILE" ] && exit 0

NORM="$(printf '%s' "$FILE" | tr "$(printf '\134\134')" '/')"

# Never gate governance artifacts — tickets, plans, logs, docs, config.
case "$NORM" in
    */Development/*|*/RoundTable/*|*/.claude/*|*/docs/*|*.md|*.txt|*.json|*.log) exit 0 ;;
esac

# Only source code is gated.
case "$NORM" in
    *.cs|*.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.go|*.rs|*.java|*.sql|*.ps1|*.sh) ;;
    *) exit 0 ;;
esac

DEV="$REPO/Development"
if [ ! -d "$DEV" ]; then
    cat >&2 <<MSG
[BLOCKED] No-Code-Before-Ticket — Development/ does not exist.

Target: $FILE

Create the Development tree and a ticket for this change before editing source.
MSG
    exit 2
fi

ACTIVE="$(grep -rl -- '^\*\*Status:\*\* \[~\]' "$DEV" 2>/dev/null | head -5)"

if [ -n "$ACTIVE" ]; then
    exit 0
fi

cat >&2 <<MSG
[BLOCKED] No-Code-Before-Ticket (CLAUDE.md §4) — no ticket is IN PROGRESS.

Target: $FILE

Not a single line of code may change until its ticket exists in Development/
and is marked "**Status:** [~] IN PROGRESS". This applies to live-discovered
bugs, approved features, quick fixes, and urgent issues alike.

HALT, create the ticket, set it IN PROGRESS, then retry.
Only Commander may waive this rule for a specific change.
MSG
exit 2
