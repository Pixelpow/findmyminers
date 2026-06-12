/**
 * Dependency-free mDNS / Zeroconf discovery.
 *
 * Many open-source miners (AxeOS/Bitaxe family in particular) advertise
 * themselves over multicast DNS. Querying mDNS finds them instantly without
 * sweeping a whole /24, and also works across the local link regardless of the
 * configured subnet.
 *
 * This is a *best-effort* hint provider: it returns a set of candidate IPs that
 * the driver registry then confirms with a real probe. Any failure resolves to
 * an empty list so discovery can fall back to the subnet sweep.
 */
import dgram from 'dgram';

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;

/** Service types worth asking about for miners. */
const SERVICE_QUERIES = [
  '_services._dns-sd._udp.local', // enumerate everything
  '_http._tcp.local',             // AxeOS web UI
  '_axe._tcp.local',              // some AxeOS builds
  '_workstation._tcp.local',
];

const MINER_NAME_HINTS = /bitaxe|nerdaxe|nerdqaxe|nerdoctaxe|piaxe|qaxe|lucky|avalon|antminer|whatsminer|axe|miner/i;

/** Encode a dotted name (e.g. "_http._tcp.local") into DNS label format. */
function encodeName(name: string): Buffer {
  const parts = name.split('.').filter(Boolean);
  const buffers = parts.map((part) => {
    const label = Buffer.from(part, 'utf8');
    return Buffer.concat([Buffer.from([label.length]), label]);
  });
  return Buffer.concat([...buffers, Buffer.from([0])]);
}

/** Build a single PTR query packet for a service name. */
function buildQuery(name: string): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);  // id
  header.writeUInt16BE(0, 2);  // flags (standard query)
  header.writeUInt16BE(1, 4);  // qdcount
  const question = Buffer.concat([
    encodeName(name),
    Buffer.from([0x00, 0x0c]), // QTYPE = PTR (12)
    Buffer.from([0x00, 0x01]), // QCLASS = IN
  ]);
  return Buffer.concat([header, question]);
}

/** Read a (possibly compressed) DNS name starting at `offset`. */
function readName(buf: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let pos = offset;
  let jumped = false;
  let next = offset;
  let safety = 0;

  while (pos < buf.length && safety++ < 128) {
    const len = buf[pos];
    if (len === 0) {
      pos += 1;
      if (!jumped) next = pos;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      // Compression pointer.
      const pointer = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) next = pos + 2;
      pos = pointer;
      jumped = true;
      continue;
    }
    const label = buf.slice(pos + 1, pos + 1 + len).toString('utf8');
    labels.push(label);
    pos += 1 + len;
  }

  return { name: labels.join('.'), next };
}

type MdnsHit = { ip: string; hostname?: string };

/**
 * Run an mDNS scan for `durationMs` and return candidate miner IPs.
 * Collects every A record seen, plus any names matching miner hints.
 */
export function discoverViaMdns(durationMs = 2000): Promise<MdnsHit[]> {
  return new Promise((resolve) => {
    const found = new Map<string, MdnsHit>();
    let socket: dgram.Socket;
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      resolve([]);
      return;
    }

    const done = () => {
      try { socket.close(); } catch { /* ignore */ }
      resolve([...found.values()]);
    };

    socket.on('error', () => done());

    socket.on('message', (msg) => {
      try {
        if (msg.length < 12) return;
        const qd = msg.readUInt16BE(4);
        const an = msg.readUInt16BE(6);
        const ns = msg.readUInt16BE(8);
        const ar = msg.readUInt16BE(10);
        let offset = 12;

        // Skip questions.
        for (let i = 0; i < qd; i++) {
          const { next } = readName(msg, offset);
          offset = next + 4; // qtype + qclass
        }

        let sawMinerName = false;
        const ips: string[] = [];

        const total = an + ns + ar;
        for (let i = 0; i < total && offset + 10 <= msg.length; i++) {
          const { name, next } = readName(msg, offset);
          const type = msg.readUInt16BE(next);
          const rdLength = msg.readUInt16BE(next + 8);
          const rdStart = next + 10;
          if (MINER_NAME_HINTS.test(name)) sawMinerName = true;

          if (type === 1 && rdLength === 4) {
            // A record → IPv4.
            const ip = `${msg[rdStart]}.${msg[rdStart + 1]}.${msg[rdStart + 2]}.${msg[rdStart + 3]}`;
            ips.push(ip);
          } else if (type === 12 || type === 33 || type === 16) {
            // PTR / SRV / TXT may carry a miner-looking target name.
            const { name: target } = readName(msg, type === 33 ? rdStart + 6 : rdStart);
            if (MINER_NAME_HINTS.test(target)) sawMinerName = true;
          }
          offset = rdStart + rdLength;
        }

        for (const ip of ips) {
          // Keep every A record; miner-named hits are kept regardless.
          if (!found.has(ip)) found.set(ip, { ip });
          if (sawMinerName) found.set(ip, { ip, hostname: 'mdns-miner' });
        }
      } catch {
        /* ignore malformed packets */
      }
    });

    socket.bind(() => {
      try {
        socket.setMulticastTTL(255);
        for (const service of SERVICE_QUERIES) {
          const packet = buildQuery(service);
          socket.send(packet, 0, packet.length, MDNS_PORT, MDNS_ADDRESS);
        }
      } catch {
        /* ignore */
      }
    });

    setTimeout(done, durationMs);
  });
}
