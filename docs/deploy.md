# Deploy — AtHome server on the home server

_The remote backend (core + WebSocket + PWA) as a systemd **user** service on the Debian 13 home server, reached only
through Tailscale Serve. Host changes (packages, linger, Tailscale Serve) are made by the `linux stup` session on
Sasha's request; the install script itself needs no sudo. Files: [deploy/](../deploy/)._

## Layout on the server
| Path | What |
|---|---|
| `/srv/apps/claude-wrap/repo` | git clone of https://github.com/sasha-bolea/claude-wrap |
| `/srv/apps/claude-wrap/releases/<commit>` | one built release per commit (`.ready` once its tests passed), ~740 MB each; after every switch only `current`, `previous` and the newest `.failed` one are kept |
| `/srv/apps/claude-wrap/current`, `previous` | symlinks: the running release, the one before (rollback) |
| `~/.config/claude-wrap/env` | the service environment (0600): root, public URL, Tailscale login — **not in the repo** |
| `~/.config/systemd/user/claude-wrap.service` | the unit ([deploy/claude-wrap.service](../deploy/claude-wrap.service)) |
| `~/.config/systemd/user/claude-wrap-update.{service,timer}` | automatic update every 5 min ([deploy/claude-wrap-update.timer](../deploy/claude-wrap-update.timer)) |
| `releases/<commit>/.failed` | that release never goes live by itself (tests failed, or `rollback.sh` left it) |
| `~/.local/bin/claude-wrap` | `claude-wrap pair --name <device>` with the service environment |
| `~/.local/bin/athome` | the `athome` command ([reference/athome-command.md](reference/athome-command.md)) with the service environment |
| `~/.local/state/claude-wrap/` | state: `state.json`, `devices.json`, `vapid.json`, `pairing/` (all owner-only), `activity.json` (sessions at work, read by the update), `callers.json` (hashed keys of the terminal's callers), `plans.json` (open plans), `actions.jsonl` (the action API's log), `terminal/athome.sock` (the `athome` command's socket, folder 0700) |
| `/srv/progetti` | the only folder sessions may run in (and the phone may browse) |

Port 3012 on 127.0.0.1 (registered in `personale/linux stup/docs/architettura.md` and `~/.claude/porte.md`);
Tailscale Serve publishes it as `https://<host>.<tailnet>.ts.net:8443`.

## First install (once)
**When:** the server has never run claude-wrap.
1. Node 24 from NodeSource (if `node --version` is not 24.x):
   `curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs`
2. Folders, owned by the service user: `sudo mkdir -p /srv/apps/claude-wrap && sudo chown "$USER": /srv/apps/claude-wrap` (and `/srv/progetti` if missing).
3. Linger, so the user service runs without a login: `sudo loginctl enable-linger "$USER"`.
4. Claude Code logged in for this user (the SDK uses the same credentials): `claude` → `/login` if needed.
5. Get the script and run it: `git clone https://github.com/sasha-bolea/claude-wrap.git /srv/apps/claude-wrap/repo && /srv/apps/claude-wrap/repo/deploy/install.sh`.
   The first run builds the release, installs the unit and the `claude-wrap` command, creates `~/.config/claude-wrap/env` from [env.example](../deploy/env.example) and stops.
6. Fill in `~/.config/claude-wrap/env`: `CLAUDE_WRAP_PUBLIC_URL` (the Serve address, port 8443) and `CLAUDE_WRAP_TAILSCALE_LOGIN` (the owner's Tailscale login, as shown by `tailscale status --json | jq -r .User[].LoginName`).
7. Run `deploy/install.sh` again (from `current/` or the repo): the service starts (`systemctl --user status claude-wrap`).
8. Tailscale Serve (HTTPS certificates enabled in the tailnet admin): `sudo tailscale serve --bg --https=8443 http://127.0.0.1:3012`. Check with `tailscale serve status`.
9. Pair the phone: `claude-wrap pair --name iphone` → open the printed link in Safari, **Add to Home Screen**, open the app from the Home screen, paste the link there. Then Settings → Notifications on.
10. Pair the desktop: `claude-wrap pair --name pc` → in the desktop app, Servers… → paste the link.

**Warnings:** the env file and `~/.local/state/claude-wrap` hold the owner's identity and device tokens (hashed):
never copy them into the repo or a ticket. Revoking a device (phone Settings) also revokes the devices it added.

## Update (automatic)
**When:** always, once the timer is installed (2026-10-03).
- `claude-wrap-update.timer` runs `install.sh main --when-idle` 5 min after boot and 5 min after each run ends. A
  new commit on `main` is built and tested as a release (core and server tests **on the server**); it goes live only
  while no session works (`activity.json`, written by the core), otherwise at the next run. A release whose tests
  failed, or that `rollback.sh` left, is marked `.failed` and never retried by the timer.
- The restart closes the open processes: tabs come back dormant (nothing is lost: transcripts are the CLI's JSONL;
  tabs where nothing was ever sent are not restored). The PWA then offers "Nuova versione disponibile · Aggiorna".
- Trust model (accepted by Sasha on 2026-10-03): whoever can push to `main` runs code on the server without a manual
  step. Keep pushes to `main` reviewed; restrict GitHub keys on the server (STATO backlog).
- Following one from the PC: [procedure.md](procedure.md#following-an-automatic-deploy-on-the-home-server).

## Update (by hand) and first install of the timer
**When:** a tag, a commit the timer skips (`.failed` after a fix), or the first time the timer is installed.
1. `/srv/apps/claude-wrap/current/deploy/install.sh` (or `install.sh <tag>`): builds, tests, switches; the old
   release becomes `previous`.
2. **First time with the timer** (an install made by a script older than the timer): run it **twice** — the first run
   (old script) brings the new release, the second (new script, from the new `current`) installs and enables the
   timer. That first build got the version label "dev" (the old script passed no commit); the next build fixes it.
3. **A commit that changes the build command** (e.g. the `@athome/*` workspace rename of 2026-10-06): the timer builds
   it with the live release's old `install.sh`, fails and marks it `.failed`. Run the new script from the repo once,
   so it builds with its own commands and switches only when no session works:
   `rm /srv/apps/claude-wrap/releases/<commit>/.failed && /srv/progetti/claude-wrap/deploy/install.sh main --when-idle`
   (from SSH: the switch restarts the service and ends the sessions inside AtHome).

## Rollback
`/srv/apps/claude-wrap/current/deploy/rollback.sh` — back to `previous`, restart.

## Logs and checks
- `journalctl --user -u claude-wrap -f` (metadata only: connections, pairing, refusals; never tokens or messages).
- `journalctl --user -u claude-wrap-update -n 30` (automatic updates: build, tests, deferred while busy, live).
- `systemctl --user list-timers claude-wrap-update.timer` (next and last check).
- No orphans after a stop: `systemctl --user stop claude-wrap && pgrep -u "$USER" -fa claude` → nothing.
- Memory: `systemctl --user show claude-wrap -p MemoryCurrent`. Limits `MemoryHigh=5G`, `MemoryMax=6G`; an OOM kill takes one claude process, not the service (`OOMPolicy=continue`).
