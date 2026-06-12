import type { NextApiRequest } from 'next';

type RateLimitEntry = { count: number; resetAt: number };

const buckets = new Map<string, RateLimitEntry>();

/** Simple in-memory rate limiter. Returns true if the request should be blocked. */
export function isRateLimited(
  req: NextApiRequest,
  { maxAttempts = 5, windowMs = 60_000 }: { maxAttempts?: number; windowMs?: number } = {},
): boolean {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.socket.remoteAddress) || 'unknown';
  const now = Date.now();

  const entry = buckets.get(ip);
  if (!entry || now > entry.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count += 1;
  if (entry.count > maxAttempts) return true;
  return false;
}

// Periodically clean expired entries (every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (now > entry.resetAt) buckets.delete(key);
    }
  }, 5 * 60 * 1000).unref?.();
}
