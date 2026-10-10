import https from 'node:https';
import { createResilientLookup } from '../../utils/resilient-lookup.js';
import { buildMime } from './mail-template.js';

/**
 * Sends mail through Microsoft Graph with an app-only token (client credentials).
 * The app registration needs the Mail.Send application permission; restrict it to the sender
 * mailbox with RBAC for Applications or an application access policy (docs/email-setup.md).
 *
 * "Accepted" means Graph returned 202: Microsoft accepted the message. Delivery to the
 * recipient's inbox cannot be confirmed by the sender.
 */
export function createGraphTransport(
  { tenantId, clientId, clientSecret, sender },
  { logger, timeoutMs = 20000 } = {},
) {
  const agent = new https.Agent({
    keepAlive: true,
    lookup: createResilientLookup({
      onFallback: (host, err) =>
        logger?.warn({ host, code: err.code }, 'DNS failed; using last known address'),
    }),
  });
  let token = null;

  function call(method, url, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, { method, agent, headers, timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
      req.on('timeout', () =>
        req.destroy(Object.assign(new Error('Request to Microsoft timed out'), { code: 'ETIMEDOUT' })),
      );
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async function accessToken() {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }).toString();
    const res = await call(
      'POST',
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(form),
        },
        body: form,
      },
    );
    let data = {};
    try {
      data = JSON.parse(res.body);
    } catch {
      /* not JSON */
    }
    if (res.status !== 200 || !data.access_token) {
      // Microsoft's error codes (e.g. AADSTS7000215 bad secret) are kept; secrets never appear in them.
      throw new Error(
        `Microsoft refused the mail app's sign-in (${res.status}): ${data.error_description?.split('\r\n')[0] ?? data.error ?? 'no detail'}`,
      );
    }
    token = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  return {
    name: 'graph',
    async send({ to, subject, html, text }) {
      const mime = Buffer.from(buildMime({ from: sender, to, subject, html, text }), 'utf8').toString(
        'base64',
      );
      const bearer = await accessToken();
      const res = await call(
        'POST',
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
        {
          headers: {
            Authorization: `Bearer ${bearer}`,
            'Content-Type': 'text/plain',
            'Content-Length': Buffer.byteLength(mime),
          },
          body: mime,
        },
      );
      if (res.status === 202) return { messageId: res.headers['request-id'] ?? null };
      if (res.status === 401) token = null;
      let detail = '';
      try {
        const e = JSON.parse(res.body).error;
        detail = `${e.code}: ${e.message}`;
      } catch {
        detail = res.body.slice(0, 300);
      }
      throw new Error(`Microsoft Graph did not accept the message (${res.status}) ${detail}`.trim());
    },
  };
}
