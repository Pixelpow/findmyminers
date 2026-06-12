/**
 * Shared low-level transports used by drivers.
 *  - cgminerQuery: one-shot JSON command over the cgminer/bmminer/btminer TCP API.
 *  - httpJson: GET/PATCH/POST JSON over HTTP (AxeOS and other REST firmwares).
 *
 * All helpers resolve to `null` (or throw with a clear message for writes)
 * instead of leaking raw socket errors.
 */
import net from 'net';
import http from 'http';

export const DEFAULT_TCP_TIMEOUT_MS = 700;
export const DEFAULT_HTTP_TIMEOUT_MS = 5000;

/**
 * Send a single command to a cgminer-style TCP API (port 4028 by default) and
 * parse the JSON reply. Resolves to `null` on timeout / connection error /
 * invalid JSON — never rejects.
 */
export function cgminerQuery(
  ip: string,
  port: number,
  command: string,
  parameter?: string,
  timeoutMs: number = DEFAULT_TCP_TIMEOUT_MS,
): Promise<any | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let data = '';
    let settled = false;

    const finish = (result: any | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const payload: Record<string, unknown> = { command };
    if (parameter) payload.parameter = parameter;

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => socket.write(JSON.stringify(payload)));
    socket.on('data', (chunk) => { data += chunk.toString('utf8'); });
    socket.on('timeout', () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('close', () => {
      if (settled) return;
      try {
        finish(JSON.parse(data.replace(/\0/g, '')));
      } catch {
        finish(null);
      }
    });

    socket.connect(port, ip);
  });
}

/**
 * Send a cgminer command and throw if it fails or the miner rejects it.
 * Used for write/control actions where silent failure is not acceptable.
 */
export async function cgminerCommandStrict(
  ip: string,
  port: number,
  command: string,
  parameter?: string,
  timeoutMs = 5000,
): Promise<any> {
  const result = await cgminerQuery(ip, port, command, parameter, timeoutMs);
  if (result === null) {
    throw new Error(`No response from ${ip}:${port} for command "${command}"`);
  }
  const status = result?.STATUS?.[0];
  if (status && status.STATUS === 'E') {
    throw new Error(status.Msg || `Miner rejected command "${command}"`);
  }
  return result;
}

/** Plain TCP connect probe: is something listening on ip:port? */
export function tcpPortOpen(ip: string, port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

/** GET a JSON document. Resolves to `null` on any error. */
export function httpGetJson(url: string, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS): Promise<any | null> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/**
 * Send a JSON body with an arbitrary method (PATCH/POST/PUT) and return the raw
 * response. Throws on transport error or non-2xx status — used for writes.
 */
export function httpJsonRequest(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body?: unknown,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) {
            resolve({ status, body: data });
          } else {
            reject(new Error(`HTTP ${status} for ${method} ${url}: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout on ${method} ${url}`)); });
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}
