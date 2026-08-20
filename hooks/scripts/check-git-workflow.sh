#!/usr/bin/env bash
# PreToolUse(Bash) — enforce the Git Workflow Rule in CLAUDE.md.
# Blocks raw state-changing git commands so they go through the /git skill,
# which carries the safety gates (branch protection, sensitive-file scan,
# upstream divergence check, 2-pass review, audit logging).
#
# Exit 0 = allow. Exit 2 = block, stderr is fed back to Claude.
# The /git skill appends "# git-skill-internal" to bypass this guard.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_json.sh
. "$DIR/_json.sh"

PAYLOAD="$(cat)"
CMD="$(json_field "$PAYLOAD" '.tool_input.command')"

[ -z "$CMD" ] && exit 0

# The /git skill's own internal operations are exempt.
case "$CMD" in
    *"# git-skill-internal"*) exit 0 ;;
esac

# Read-only git is always fine — only state changes are governed.
BLOCKED=""
if printf '%s' "$CMD" | grep -qE '(^|[;&|(]|&&)[[:space:]]*git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?(push|commit|merge|rebase|pull)([[:space:]]|$)'; then
    BLOCKED="$(printf '%s' "$CMD" | grep -oE 'git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?(push|commit|merge|rebase|pull)' | head -1)"
fi
if printf '%s' "$CMD" | grep -qE 'git[[:space:]]+reset[[:space:]]+.*--hard'; then
    BLOCKED="git reset --hard"
fi

[ -z "$BLOCKED" ] && exit 0

case "$BLOCKED" in
    *push*)   USE="/git pr    — branch enforcement, review, test, push, pull request" ;;
    *commit*) USE="/git commit — safety gates, 2-pass review, ticket gate, commit" ;;
    *merge*|*rebase*|*pull*) USE="/git sync   — governed fetch + merge/rebase with conflict walkthrough" ;;
    *)        USE="git stash / git checkout -- .  — non-destructive alternatives" ;;
esac

cat >&2 <<MSG
[BLOCKED] Raw git is not allowed: "$BLOCKED"

Git Workflow Rule (CLAUDE.md) — every state-changing git command must go
through a governed /git skill. Raw git bypasses: branch protection,
sensitive-file scan, upstream divergence check, 2-pass review, and audit logging.

Use instead:  $USE

Read-only git (status, log, diff, show, fetch, ls-files) is always permitted.
MSG
exit 2
