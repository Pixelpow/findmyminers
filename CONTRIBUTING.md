# Contributing to FindMyMiners

Thanks for helping make miner monitoring open and vendor-neutral! 🎉

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Create an account from the UI, then add miners via **Discover** (network scan)
or manually under **Miners**.

## Project layout

```
src/server/drivers/      ← miner protocols (one file per family) + registry
src/server/discovery/    ← mDNS + port-knock pre-scan
src/server/              ← telemetry store, alerts, profitability, auth…
src/pages/api/miner/     ← discover / scan / fleet / control / batch-control
src/pages/api/agent/     ← ingest / heartbeat / commands (agent channel)
agent/windows-miner-agent ← cross-platform Node agent (win / linux / arm64)
docs/DRIVERS.md          ← how to add a new miner
```

## The most useful contribution: a new driver

If your miner isn't supported, add a driver — it's a single file and everything
else (discovery, fleet view, control, agent) picks it up automatically. Follow
[docs/DRIVERS.md](docs/DRIVERS.md).

## Ground rules

- **No telemetry should leave the user's network** except to their own
  dashboard. Don't add third-party analytics or phone-home calls.
- `detect()` / `poll()` must never throw; `control()` should throw on failure.
- Keep hashrate in TH/s, temps in °C, power in W when filling a `MinerSnapshot`.
- Run `npm run lint` and `npx tsc --noEmit` before opening a PR.
- Match the surrounding code style (no new formatter configs in a feature PR).

## Security

- Never commit anything under `data/` (auth hashes, the VAPID private key, the
  SQLite DB) or a real `agent-config.json` — they're gitignored for a reason.
- Report security issues privately rather than opening a public issue.

## Commit / PR

- Small, focused PRs with a clear description of the *why*.
- Link the miner model + firmware version you tested against when adding/fixing
  a driver — protocol quirks are very model-specific.
