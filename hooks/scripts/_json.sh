#!/usr/bin/env bash
# Shared helper: extract a field from the hook's stdin JSON payload.
# Uses jq when available, otherwise falls back to a sed extractor so the
# hooks keep working on boxes where jq is not on PATH.
# Usage: json_field "$PAYLOAD" '.tool_input.command'  /  json_field "$P" '.tool_input.file_path'
json_field() {
    local payload="$1" path="$2"
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$payload" | jq -r "$path // empty" 2>/dev/null
        return
    fi
    # Fallback: pull the last path segment as a plain JSON string key.
    local key="${path##*.}"
    printf '%s' "$payload" \
        | tr -d '\n' \
        | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\(\([^\"\\]\|\\.\)*\)\".*/\1/p" \
        | sed 's/\\"/"/g; s/\\/\/g'
}
