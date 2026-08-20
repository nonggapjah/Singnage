#!/usr/bin/env bash
# PostToolUse(Edit|Write) — append the file change to the session audit trail.
# Fail-open by design: an audit-log problem must never fail the tool call
# that already succeeded. Always exits 0.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null)" || exit 0
# shellcheck source=_json.sh
. "$DIR/_json.sh" 2>/dev/null || exit 0

REPO="$(cd "$DIR/../.." && pwd 2>/dev/null)" || exit 0
LOGDIR="$REPO/hooks/logs"
mkdir -p "$LOGDIR" 2>/dev/null || exit 0

PAYLOAD="$(cat)"
FILE="$(json_field "$PAYLOAD" '.tool_input.file_path')"
TOOL="$(json_field "$PAYLOAD" '.tool_name')"

[ -z "$FILE" ] && exit 0

STAMP="$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo 'unknown-time')"
printf '%s\t%s\t%s\n' "$STAMP" "${TOOL:-Edit}" "$FILE" \
    >> "$LOGDIR/file-changes-$(date '+%d-%m-%Y' 2>/dev/null || echo unknown).log" 2>/dev/null

exit 0
