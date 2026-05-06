#!/bin/bash
# Install Cloe Desktop's Hermes integration: hook, plugin, and skills
# Usage:
#   ./scripts/install-hermes-integration.sh              # install all
#   ./scripts/install-hermes-integration.sh --hook        # install hook only
#   ./scripts/install-hermes-integration.sh --plugin      # install plugin only
#   ./scripts/install-hermes-integration.sh --skills      # install skills only
#   ./scripts/install-hermes-integration.sh --uninstall   # remove everything
set -e

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
HERMES_DIR="${HOME}/.hermes"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }

backup_if_exists() {
    local target="$1"
    if [[ -e "$target" ]]; then
        local backup="${target}.bak.$(date +%Y%m%d%H%M%S)"
        mv "$target" "$backup"
        warn "Backed up existing ${target} → ${backup}"
    fi
}

install_hook() {
    local src="${REPO_ROOT}/docs/hermes-hook"
    local dst="${HERMES_DIR}/hooks/cloe-desktop"

    echo ""
    echo "=== Installing Hermes Hook ==="
    echo "Source: docs/hermes-hook/"
    echo "Target: ${dst}"
    echo ""

    if [[ ! -f "${src}/handler.py" ]]; then
        err "docs/hermes-hook/handler.py not found"
    fi

    backup_if_exists "$dst"
    mkdir -p "$(dirname "$dst")"
    cp -r "$src" "$dst"
    rm -rf "${dst}/__pycache__"
    ok "Hook installed to ${dst}"
}

install_plugin() {
    local src="${REPO_ROOT}/docs/hermes-plugin"
    local dst="${HERMES_DIR}/plugins/cloe-desktop"

    echo ""
    echo "=== Installing Hermes Plugin ==="
    echo "Source: docs/hermes-plugin/"
    echo "Target: ${dst}"
    echo ""

    if [[ ! -f "${src}/handler.py" ]]; then
        err "docs/hermes-plugin/handler.py not found"
    fi

    backup_if_exists "$dst"
    mkdir -p "$(dirname "$dst")"
    cp -r "$src" "$dst"
    rm -rf "${dst}/__pycache__"
    ok "Plugin installed to ${dst}"
}

install_skills() {
    local src_dir="${REPO_ROOT}/docs/skills"
    local dst_base="${HERMES_DIR}/skills"

    echo ""
    echo "=== Installing Hermes Skills ==="
    echo "Source: docs/skills/"
    echo "Target: ${dst_base}/creative/"
    echo ""

    # Each subdirectory containing SKILL.md is a skill
    for skill_dir in "${src_dir}"/*/; do
        [[ -d "$skill_dir" ]] || continue

        local skill_name
        skill_name=$(basename "$skill_dir")

        if [[ ! -f "${skill_dir}SKILL.md" ]]; then
            warn "Skipping ${skill_name}: no SKILL.md found"
            continue
        fi

        local dst="${dst_base}/creative/${skill_name}"
        backup_if_exists "$dst"
        cp -r "$skill_dir" "$dst"
        rm -rf "${dst}/__pycache__"

        ok "Skill '${skill_name}' → ${dst}/"
    done
}

uninstall_all() {
    echo ""
    echo "=== Uninstalling Cloe Desktop Hermes Integration ==="

    for path in \
        "${HERMES_DIR}/hooks/cloe-desktop" \
        "${HERMES_DIR}/plugins/cloe-desktop" \
        "${HERMES_DIR}/skills/creative/cloe-desktop-action" \
        "${HERMES_DIR}/skills/creative/cloe-android" \
        "${HERMES_DIR}/skills/creative/cloe-desktop"; do
        if [[ -e "$path" ]]; then
            rm -rf "$path"
            ok "Removed ${path}"
        fi
    done

    echo ""
    ok "Cleanup complete"
}

# Parse arguments
INSTALL_HOOK=false
INSTALL_PLUGIN=false
INSTALL_SKILLS=false
UNINSTALL=false

case "${1:---all}" in
    --hook)      INSTALL_HOOK=true ;;
    --plugin)    INSTALL_PLUGIN=true ;;
    --skills)    INSTALL_SKILLS=true ;;
    --uninstall) UNINSTALL=true ;;
    --all|-a|"") INSTALL_HOOK=true; INSTALL_PLUGIN=true; INSTALL_SKILLS=true ;;
    *)           echo "Usage: $0 [--hook|--plugin|--skills|--all|--uninstall]"; exit 1 ;;
esac

if $UNINSTALL; then
    uninstall_all
    exit 0
fi

# Check Hermes directory exists
if [[ ! -d "$HERMES_DIR" ]]; then
    warn "Hermes directory not found at ${HERMES_DIR}"
    read -p "Create it? [Y/n] " answer
    [[ "$answer" =~ ^[Nn] ]] && exit 1
    mkdir -p "$HERMES_DIR"
fi

$INSTALL_HOOK   && install_hook
$INSTALL_PLUGIN && install_plugin
$INSTALL_SKILLS && install_skills

echo ""
echo "═══════════════════════════════════════"
echo ""
warn "Hook and plugin changes require a Hermes gateway restart:"
echo ""
echo "  source ~/.hermes/hermes-agent/venv/bin/activate"
echo "  python -m hermes_cli.main gateway run --replace"
echo ""
echo "Plugin rules (plugin-rules.json) hot-reload within 5s — no restart needed."
echo ""
