import { describe, it, expect } from 'vitest';
import { createResilientLookup, retryOnConnectFailure } from '../src/utils/resilient-lookup.js';

const lookupAsync = (lookup, host) =>
  new Promise((resolve, reject) =>
    lookup(host, {}, (err, address, family) => (err ? reject(err) : resolve({ address, family }))),
  );

function flakyResolver(script) {
  let i = 0;
  return (host, opts, cb) => {
    const step = script[Math.min(i++, script.length - 1)];
    if (step instanceof Error) setImmediate(() => cb(step));
    else setImmediate(() => cb(null, step, 4));
  };
}
const dnsError = (code) => Object.assign(new Error(`getaddrinfo ${code} example`), { code });

describe('resilient DNS lookup', () => {
  it('uses the last good address when the resolver briefly fails', async () => {
    const fallbacks = [];
    const lookup = createResilientLookup({
      resolve: flakyResolver(['20.190.177.82', dnsError('ENOTFOUND')]),
      onFallback: (host) => fallbacks.push(host),
    });
    expect(await lookupAsync(lookup, 'login.microsoftonline.com')).toEqual({
      address: '20.190.177.82',
      family: 4,
    });
    expect(await lookupAsync(lookup, 'login.microsoftonline.com')).toEqual({
      address: '20.190.177.82',
      family: 4,
    });
    expect(fallbacks).toEqual(['login.microsoftonline.com']);
  });

  it('prefers a fresh answer whenever the resolver works', async () => {
    const lookup = createResilientLookup({ resolve: flakyResolver(['1.1.1.1', '2.2.2.2']) });
    await lookupAsync(lookup, 'h');
    expect((await lookupAsync(lookup, 'h')).address).toBe('2.2.2.2');
  });

  it('fails when there is no earlier answer, or the earlier answer is too old', async () => {
    const noCache = createResilientLookup({ resolve: flakyResolver([dnsError('ENOTFOUND')]) });
    await expect(lookupAsync(noCache, 'h')).rejects.toThrow(/ENOTFOUND/);

    const stale = createResilientLookup({
      resolve: flakyResolver(['1.1.1.1', dnsError('EAI_AGAIN')]),
      maxStaleMs: -1,
    });
    await lookupAsync(stale, 'h');
    await expect(lookupAsync(stale, 'h')).rejects.toThrow(/EAI_AGAIN/);
  });
});

describe('retryOnConnectFailure', () => {
  it('retries DNS and connection failures, then succeeds', async () => {
    let calls = 0;
    const result = await retryOnConnectFailure(
      async () => {
        calls += 1;
        if (calls < 3) throw dnsError('ENOTFOUND');
        return 'ok';
      },
      { delayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('never retries an error returned by the server', async () => {
    let calls = 0;
    const serverError = Object.assign(new Error('invalid_client'), { name: 'OPError' });
    await expect(
      retryOnConnectFailure(
        async () => {
          calls += 1;
          throw serverError;
        },
        { delayMs: 1 },
      ),
    ).rejects.toBe(serverError);
    expect(calls).toBe(1);
  });
});
