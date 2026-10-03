#!/usr/bin/env bash
# Switches claude-wrap back to the previous release and restarts it. The release left behind is marked .failed, so
# the automatic update (install.sh --when-idle) does not bring it back; a newer commit, or install.sh by hand, does.
# CLAUDE_WRAP_APP_DIR overrides the default (deploy test only).
set -euo pipefail
APP="${CLAUDE_WRAP_APP_DIR:-/srv/apps/claude-wrap}"
[ -L "$APP/previous" ] || { echo "No previous release."; exit 1; }
FROM=$(readlink "$APP/current")
ln -sfn "$(readlink "$APP/previous")" "$APP/current"
ln -sfn "$FROM" "$APP/previous"
touch "$FROM/.failed"
systemctl --user restart claude-wrap
echo "Now running $(basename "$(readlink "$APP/current")")."
