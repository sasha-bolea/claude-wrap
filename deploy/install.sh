#!/usr/bin/env bash
# Installs or updates claude-wrap on the home server, as the service user (no sudo).
# Each version is a release under /srv/apps/claude-wrap/releases/<commit>; `current` points at the running one and
# `previous` at the one before (deploy/rollback.sh switches back). A release goes live only if its tests pass.
# Usage: install.sh [git ref]   (default: main)
set -euo pipefail

APP=/srv/apps/claude-wrap
REPO_URL=https://github.com/sasha-bolea/claude-wrap.git
REF="${1:-main}"
ENV_FILE="$HOME/.config/claude-wrap/env"

mkdir -p "$APP/releases"
[ -d "$APP/repo" ] || git clone --quiet "$REPO_URL" "$APP/repo"
git -C "$APP/repo" fetch --quiet --tags origin
SHA=$(git -C "$APP/repo" rev-parse --verify --quiet "origin/$REF" || git -C "$APP/repo" rev-parse --verify "$REF^{commit}")
RELEASE="$APP/releases/$SHA"

if [ ! -f "$RELEASE/.ready" ]; then
  echo "Building release $SHA"
  rm -rf "$RELEASE" && mkdir -p "$RELEASE"
  git -C "$APP/repo" archive "$SHA" | tar -x -C "$RELEASE"
  # The desktop toolchain is a devDependency: skip Electron's binary download on the server.
  (cd "$RELEASE" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund)
  (cd "$RELEASE" && npm run build -w @claude-wrap/mobile)
  # Server and core tests on this machine (Linux process groups, shell, WebSocket) before going live.
  (cd "$RELEASE" && npx vitest run packages/core packages/server)
  touch "$RELEASE/.ready"
fi

# First install: unit, `claude-wrap` command, environment file to fill in.
mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/claude-wrap" "$HOME/.local/bin"
cp "$RELEASE/deploy/claude-wrap.service" "$HOME/.config/systemd/user/claude-wrap.service"
cp "$RELEASE/deploy/claude-wrap" "$HOME/.local/bin/claude-wrap" && chmod 755 "$HOME/.local/bin/claude-wrap"
if [ ! -f "$ENV_FILE" ]; then
  install -m 600 "$RELEASE/deploy/env.example" "$ENV_FILE"
  echo "Fill in $ENV_FILE, then run this script again."
  exit 1
fi

# Switch: previous ← current, current ← this release, restart.
if [ -L "$APP/current" ] && [ "$(readlink "$APP/current")" != "$RELEASE" ]; then ln -sfn "$(readlink "$APP/current")" "$APP/previous"; fi
ln -sfn "$RELEASE" "$APP/current"
systemctl --user daemon-reload
systemctl --user enable --quiet claude-wrap
systemctl --user restart claude-wrap
sleep 2
systemctl --user --no-pager --lines=5 status claude-wrap
echo "claude-wrap $SHA is live."
