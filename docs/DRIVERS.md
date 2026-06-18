# Writing a miner driver

A **driver** teaches FindMyMiners how to talk to one family of miners over one
protocol. Discovery, fleet polling, the control endpoints and the on-prem agent
all go through the driver registry, so **adding a miner = adding one file**.

## The interface

Every driver implements [`MinerDriver`](../src/server/drivers/types.ts):

```ts
export interface MinerDriver {
  protocol: MinerProtocol;          // 'cgminer' | 'axeos' | 'whatsminer' | 'antminer' | <yours>
  label: string;                    // shown in the UI, e.g. "AxeOS HTTP"
  ports: number[];                  // ports to probe during discovery
  capabilities: MinerCapability[];  // which control actions you support

  detect(ip, port, timeoutMs): Promise<MinerIdentity | null>;  // cheap "is it you?"
  poll(ip, port, timeoutMs?):  Promise<PollResult | null>;     // full telemetry
  control(ip, port, action, value?): Promise<void>;            // run an action
}
```

Rules:

- **`detect` and `poll` must never throw** — return `null` on any failure. The
  shared transport helpers in [`transport.ts`](../src/server/drivers/transport.ts)
  already swallow socket/HTTP errors for reads.
- **`control` should throw** with a human-readable message on failure, and
  reject early for any action not in `capabilities`.
- `poll` must return a normalised [`MinerSnapshot`](../src/server/telemetry-store.ts)
  with hashrate in **TH/s**, temperatures in °C and power in W.

## Capabilities

`capabilities` is the contract with the UI: the fleet page only renders the
controls a miner actually supports. Available actions:

`reboot`, `fan`, `mode`, `target-temp`, `smart-speed`, `switchpool`, `led`,
`frequency`, `voltage`.

A read-only driver simply declares `capabilities: []`.

## Step by step

1. Create `src/server/drivers/<name>-driver.ts` and export a `MinerDriver`.
2. Use the shared transports:
   - `cgminerQuery(ip, port, command, parameter?, timeoutMs?)` — JSON-over-TCP
     (cgminer / bmminer / btminer), returns `null` on failure.
   - `cgminerCommandStrict(...)` — same, but throws (use it in `control`).
   - `httpGetJson(url, timeoutMs?)` — read JSON over HTTP.
   - `httpJsonRequest(url, 'PATCH'|'POST'|'PUT', body?, timeoutMs?)` — write,
     throws on non-2xx.
   - `tcpPortOpen(ip, port, timeoutMs?)` — fast liveness check.
3. Add a clean model name to [`device-names.ts`](../src/server/drivers/device-names.ts)
   so the UI shows "Bitaxe Gamma" instead of a raw firmware string.
4. Register it in [`drivers/index.ts`](../src/server/drivers/index.ts) by adding
   it to the `DRIVERS` array. **Order matters** for detection: list specific
   drivers before generic catch-alls (the generic cgminer driver is last).
5. If your miner advertises over mDNS, add its service/name hints to
   [`discovery/mdns.ts`](../src/server/discovery/mdns.ts) for instant discovery.

That's it — discovery, the fleet view, single/batch control and the agent all
pick it up automatically.

## Good first contributions

- **Antminer write control** — stock firmware needs the authenticated web CGI
  (`/cgi-bin/*.cgi`, HTTP digest auth). The driver in
  [`antminer-driver.ts`](../src/server/drivers/antminer-driver.ts) already does
  detection + monitoring; `control()` is the missing piece (and needs per-miner
  credentials on `MinerNode`).
- **Whatsminer write control** — implement MicroBT's token/AES Write API in
  [`whatsminer-driver.ts`](../src/server/drivers/whatsminer-driver.ts).
- **BraiinsOS**, **Goldshell**, **IceRiver** — new drivers welcome.

## How the agent runs control

For agent-managed miners the dashboard can't reach the LAN directly, so it
queues commands the agent picks up (see
[`command-queue.ts`](../src/server/command-queue.ts) and
[`/api/agent/commands`](../src/pages/api/agent/commands.ts)). The agent executes
the same actions locally — if you add a new protocol with control, mirror the
execution in `agent/windows-miner-agent/src/index.js` (`executeCgminerControl` /
`executeAxeOsControl`).
