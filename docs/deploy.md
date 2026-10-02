# Deploy — claude-wrap server on the home server

_The remote backend (core + WebSocket + PWA) as a systemd **user** service on the Debian 13 home server, reached only
through Tailscale Serve. Host changes (packages, linger, Tailscale Serve) are made by the `linux stup` session on
Sasha's request; the install script itself needs no sudo. Files: [deploy/](../deploy/)._

## Layout on the server
| Path | What |
|---|---|
| `/srv/apps/claude-wrap/repo` | git clone of https://github.com/sasha-bolea/claude-wrap |
| `/srv/apps/claude-wrap/releases/<commit>` | one built release per commit (`.ready` once its tests passed) |
| `/srv/apps/claude-wrap/current`, `previous` | symlinks: the running release, the one before (rollback) |
| `~/.config/claude-wrap/env` | the service environment (0600): root, public URL, Tailscale login — **not in the repo** |
| `~/.config/systemd/user/claude-wrap.service` | the unit ([deploy/claude-wrap.service](../deploy/claude-wrap.service)) |
| `~/.local/bin/claude-wrap` | `claude-wrap pair --name <device>` with the service environment |
| `~/.local/state/claude-wrap/` | state: `state.json`, `devices.json`, `vapid.json`, `pairing/` (all owner-only) |
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

## Update
**When:** a new version is on `main` (or a tag).
1. `/srv/apps/claude-wrap/current/deploy/install.sh` (or `install.sh <tag>`).
   It builds the new release, runs the core and server tests **on the server** (Linux process groups, shell, WebSocket) and switches `current` only if they pass; the old release becomes `previous`.
2. Open sessions are closed by the restart (tabs come back dormant; nothing is lost: transcripts are the CLI's JSONL).

## Rollback
`/srv/apps/claude-wrap/current/deploy/rollback.sh` — back to `previous`, restart.

## Logs and checks
- `journalctl --user -u claude-wrap -f` (metadata only: connections, pairing, refusals; never tokens or messages).
- No orphans after a stop: `systemctl --user stop claude-wrap && pgrep -u "$USER" -fa claude` → nothing.
- Memory: `systemctl --user show claude-wrap -p MemoryCurrent`. Limits `MemoryHigh=5G`, `MemoryMax=6G`; an OOM kill takes one claude process, not the service (`OOMPolicy=continue`).
