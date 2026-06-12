#!/usr/bin/env bash
# Install the prototype skill into a project's harness skills dir.
# The design-lint linter stays in this package; the skill's detect.mjs resolves
# it via $DESIGN_LINT_DIR (exported below as a hint) or its own walk-up search.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-}"
HARNESS="${2:-.claude}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: ./install.sh <project-dir> [harness-dir, default .claude]" >&2
  echo "  e.g. ./install.sh ~/code/my-app          # -> my-app/.claude/skills/prototype" >&2
  echo "       ./install.sh ~/code/my-app .agents   # -> my-app/.agents/skills/prototype" >&2
  exit 1
fi

command -v deno >/dev/null 2>&1 || { echo "Warning: 'deno' not found on PATH — design-lint needs it at runtime." >&2; }

DEST="$TARGET/$HARNESS/skills/prototype"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$PKG_DIR/skill/prototype" "$DEST"

echo "Installed skill -> $DEST"
echo
echo "design-lint stays at: $PKG_DIR/design-lint"
echo "If the skill can't auto-discover it, set in your agent's environment:"
echo "  export DESIGN_LINT_DIR=\"$PKG_DIR/design-lint\""
