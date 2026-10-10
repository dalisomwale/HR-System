import dns from 'node:dns';

/**
 * DNS lookup that remembers the last good answer for each host and falls back to it when the
 * resolver fails (ENOTFOUND / EAI_AGAIN / timeouts). Used for outbound calls to Microsoft on
 * networks whose DNS answers intermittently. Fresh answers are always preferred; the remembered
 * one is used only when a lookup fails, and only for `maxStaleMs`.
 */
const RESOLVER_FAILURES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED']);

export function createResilientLookup({
  resolve = dns.lookup,
  maxStaleMs = 6 * 60 * 60 * 1000,
  onFallback,
} = {}) {
  const cache = new Map(); // key -> { address, family, all, at }

  return function lookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const opts = typeof options === 'number' ? { family: options } : { ...options };
    const key = `${hostname}|${opts.family ?? 0}|${opts.all ? 'all' : 'one'}`;

    resolve(hostname, opts, (err, address, family) => {
      if (!err) {
        cache.set(key, { address, family, at: Date.now() });
        return callback(null, address, family);
      }
      const hit = cache.get(key);
      if (hit && RESOLVER_FAILURES.has(err.code) && Date.now() - hit.at <= maxStaleMs) {
        onFallback?.(hostname, err);
        return callback(null, hit.address, hit.family);
      }
      callback(err);
    });
  };
}

const CONNECT_FAILURES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/**
 * Retry an operation when it failed before reaching the remote server (DNS or connection
 * errors). Errors returned by the server itself are never retried.
 */
export async function retryOnConnectFailure(fn, { attempts = 3, delayMs = 800 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code =
        err?.code ?? err?.cause?.code ?? (Array.isArray(err?.errors) ? err.errors[0]?.code : undefined);
      if (!CONNECT_FAILURES.has(code) || i === attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
  throw lastErr;
}
