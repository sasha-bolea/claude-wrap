#!/usr/bin/env bash
# Switches claude-wrap back to the previous release and restarts it.
set -euo pipefail
APP=/srv/apps/claude-wrap
[ -L "$APP/previous" ] || { echo "No previous release."; exit 1; }
FROM=$(readlink "$APP/current")
ln -sfn "$(readlink "$APP/previous")" "$APP/current"
ln -sfn "$FROM" "$APP/previous"
systemctl --user restart claude-wrap
echo "Now running $(basename "$(readlink "$APP/current")")."
