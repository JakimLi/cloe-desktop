#!/bin/bash
set -euo pipefail

SOCK="/tmp/tailscaled.sock"
STATE="/tmp/tailscaled.state"

# 清理陈旧 socket，避免 address already in use
rm -f "$SOCK"

exec /usr/local/bin/tailscaled \
  --tun=userspace-networking \
  --socket="$SOCK" \
  --state="$STATE"
