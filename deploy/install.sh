#!/usr/bin/env bash
# Installs or updates AtHome on the home server, as the service user (no sudo).
# Each version is a release under /srv/apps/claude-wrap/releases/<commit>; `current` points at the running one and
# `previous` at the one before (deploy/rollback.sh switches back). A release goes live only if its tests pass; after a
# switch only current, previous and the newest failed release are kept.
# Usage: install.sh [git ref] [--when-idle]   (default ref: main)
#   --when-idle  run by claude-wrap-update.timer: does nothing when the ref is already live, or marked .failed (its
#                tests failed, or rollback.sh left it); otherwise builds and tests it, and switches only while no
#                session is working (the core keeps their number in activity.json), else the next run switches.
# CLAUDE_WRAP_APP_DIR and CLAUDE_WRAP_REPO_URL override the defaults (deploy test only).
set -euo pipefail

APP="${CLAUDE_WRAP_APP_DIR:-/srv/apps/claude-wrap}"
REPO_URL="${CLAUDE_WRAP_REPO_URL:-https://github.com/sasha-bolea/claude-wrap.git}"
ENV_FILE="$HOME/.config/claude-wrap/env"
REF=main
WHEN_IDLE=0
for arg in "$@"; do
  case "$arg" in
    --when-idle) WHEN_IDLE=1 ;;
    *) REF="$arg" ;;
  esac
done

# Sessions at work right now, from the core's activity.json: 0 when the service is not running.
working_sessions() {
  systemctl --user is-active --quiet claude-wrap || { echo 0; return; }
  local state
  state=$(sed -n 's/^CLAUDE_WRAP_STATE_DIR=//p' "$ENV_FILE" 2>/dev/null | tail -n 1 || true)
  node -e 'try { process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).working ?? 0)) } catch { process.stdout.write("0") }' \
    "${state:-$HOME/.local/state/claude-wrap}/activity.json"
}

mkdir -p "$APP/releases"
[ -d "$APP/repo" ] || git clone --quiet "$REPO_URL" "$APP/repo"
git -C "$APP/repo" fetch --quiet --tags origin
SHA=$(git -C "$APP/repo" rev-parse --verify --quiet "origin/$REF" || git -C "$APP/repo" rev-parse --verify "$REF^{commit}")
RELEASE="$APP/releases/$SHA"

if [ "$WHEN_IDLE" = 1 ]; then
  [ "$(readlink "$APP/current" 2>/dev/null)" = "$RELEASE" ] && exit 0
  [ -f "$RELEASE/.failed" ] && exit 0
fi

if [ ! -f "$RELEASE/.ready" ]; then
  echo "Building release $SHA"
  rm -rf "$RELEASE" && mkdir -p "$RELEASE"
  git -C "$APP/repo" archive "$SHA" | tar -x -C "$RELEASE"
  # The desktop toolchain is a devDependency: skip Electron's binary download on the server. The commit names the
  # PWA build (shown in its settings). Server and core tests run on this machine (Linux process groups, shell,
  # WebSocket) before going live.
  if ! (cd "$RELEASE" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund &&
    CLAUDE_WRAP_BUILD="$SHA" npm run build -w @athome/mobile && npx vitest run packages/core packages/server); then
    touch "$RELEASE/.failed"
    echo "Release $SHA failed to build or pass its tests: $(basename "$(readlink "$APP/current" 2>/dev/null || echo none)") stays live."
    exit 1
  fi
  touch "$RELEASE/.ready"
fi

if [ "$WHEN_IDLE" = 1 ] && [ "$(working_sessions)" != 0 ]; then
  echo "Release $SHA is ready; a session is working, switching at the next run."
  exit 0
fi

# First install: units, `claude-wrap` and `athome` commands, environment file to fill in.
mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/claude-wrap" "$HOME/.local/bin"
cp "$RELEASE/deploy/claude-wrap.service" "$RELEASE/deploy/claude-wrap-update.service" "$RELEASE/deploy/claude-wrap-update.timer" "$HOME/.config/systemd/user/"
cp "$RELEASE/deploy/claude-wrap" "$HOME/.local/bin/claude-wrap" && chmod 755 "$HOME/.local/bin/claude-wrap"
cp "$RELEASE/deploy/athome" "$HOME/.local/bin/athome" && chmod 755 "$HOME/.local/bin/athome"
if [ ! -f "$ENV_FILE" ]; then
  install -m 600 "$RELEASE/deploy/env.example" "$ENV_FILE"
  echo "Fill in $ENV_FILE, then run this script again."
  exit 1
fi

# Switch: previous ← current, current ← this release, restart.
if [ -L "$APP/current" ] && [ "$(readlink "$APP/current")" != "$RELEASE" ]; then ln -sfn "$(readlink "$APP/current")" "$APP/previous"; fi
ln -sfn "$RELEASE" "$APP/current"

# Old releases (~740 MB each, node_modules included): keep current, previous (rollback.sh) and the newest failed one
# (to look into); remove the rest. A removed failed release is an older commit, so the timer never builds it again.
PREVIOUS=$(readlink "$APP/previous" 2>/dev/null || true)
LAST_FAILED=$(ls -td "$APP"/releases/*/.failed 2>/dev/null | head -n 1 | xargs -r dirname || true)
for dir in "$APP"/releases/*/; do
  dir=${dir%/}
  case "$dir" in "$RELEASE" | "$PREVIOUS" | "$LAST_FAILED") ;; *) rm -rf "$dir" ;; esac
done

systemctl --user daemon-reload
systemctl --user enable --quiet claude-wrap
systemctl --user enable --now --quiet claude-wrap-update.timer
systemctl --user restart claude-wrap
sleep 2
systemctl --user --no-pager --lines=5 status claude-wrap
echo "AtHome $SHA is live."
