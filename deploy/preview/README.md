# Live preview of the UI (temporary)

The real AtHome interface (the PWA) on a fake backend, to design UI changes with Sasha and see them at once: every
change to `packages/ui` or `apps/mobile` reaches the open page by hot reload. Desktop and phone layouts are the same
app at different widths (three columns from 1024 px).

- **Link**: https://server.taildb4b9b.ts.net:8448 (Tailscale only; Serve 8448 → 127.0.0.1:3007, run by Sasha).
- **Containers** (`docker-compose.yml`): `ui` = Vite's dev server (`apps/mobile/vite.preview.config.ts`, port 3007);
  `backend` = a real AtHome server on the scripted fake SDK (zero quota), reachable only from `ui`.
- **Data**: `/srv/progetti/claude-wrap/.preview/` (git-ignored) — `root/` is its Home (sample folders `project`,
  `altro-progetto`), `state/` its state and paired devices, `home/` its Claude folder. Never the real app's.
- **Fake answers**: the scripted SDK echoes messages (`Echo: …`); `slow` streams a long answer, `infinito` streams until Stop, `permission` asks for a
  permission (see `packages/core/src/testing`).

## Pair a device
The preview has its own devices. Print a link (valid 10 minutes) and open it on the device:

```
cd /srv/progetti/claude-wrap
CLAUDE_WRAP_ROOT=$PWD/.preview/root CLAUDE_WRAP_STATE_DIR=$PWD/.preview/state \
CLAUDE_WRAP_PUBLIC_URL=https://server.taildb4b9b.ts.net:8448 node packages/server/src/cli.ts pair --name "<device>"
```

## Run, stop, retire
- `docker compose up -d` / `docker compose down` here. A change to the server or core code needs
  `docker compose restart backend`; UI changes need nothing.
- Monitor: Uptime Kuma HTTP on `http://127.0.0.1:3007/`.
- Retire (server protocol "Ritirare qualcosa"): monitor first, `docker compose down`,
  `sudo tailscale serve --https=8448 off`, inventory rows 3007/8448, `rm -rf .preview`.
