/*
 * Text messages through Africa's Talking (D127). Used for phone sign-in codes, so AMS branch
 * staff get their code on the phone they sign in with.
 *
 *   SMS_PROVIDER=africastalking  AT_USERNAME, AT_API_KEY (and optionally AT_SENDER_ID)
 *   SMS_PROVIDER=disabled        nothing is sent; callers show the code on screen instead
 *
 * The username "sandbox" uses Africa's Talking's sandbox, which sends nothing real.
 * sendSms never throws: it returns { sent: true } or { sent: false, error } in plain words.
 * The message text is never logged, since it can hold a sign-in code.
 */
const TIMEOUT_MS = 15000;

// Africa's Talking recipient status codes that mean the message was accepted.
const ACCEPTED = new Set([100, 101, 102]);
const PROBLEMS = {
  401: 'the message was held by Africa’s Talking for review',
  402: 'the sender name (AT_SENDER_ID) is not approved',
  403: 'the phone number is not valid',
  404: 'the phone number’s network is not supported',
  405: 'the Africa’s Talking account has no credit left',
  406: 'the person has blocked messages from this sender',
  407: 'the message could not be routed to the network',
  409: 'the message was rejected as a duplicate',
  500: 'Africa’s Talking had an internal error',
  501: 'Africa’s Talking had a gateway error',
  502: 'the network rejected the message',
};

export const smsEnabled = (sms) => Boolean(sms && sms.provider === 'africastalking' && sms.username && sms.apiKey);

export async function sendSms(sms, { to, message }, { fetchImpl = fetch, logger } = {}) {
  if (!smsEnabled(sms)) return { sent: false, error: 'text messages are not set up (SMS_PROVIDER)' };
  if (!/^\+\d{8,15}$/.test(String(to ?? ''))) return { sent: false, error: 'the phone number is not valid' };
  const host = sms.username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
  const body = new URLSearchParams({ username: sms.username, to, message });
  if (sms.senderId) body.set('from', sms.senderId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`https://${host}/version1/messaging`, {
      method: 'POST',
      headers: {
        apiKey: sms.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: controller.signal,
    });
    const raw = await res.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (!res.ok) {
      const error =
        res.status === 401
          ? 'Africa’s Talking refused the username or API key'
          : `Africa’s Talking answered ${res.status}${raw ? `: ${raw.slice(0, 120)}` : ''}`;
      logger?.warn({ status: res.status }, 'SMS not sent');
      return { sent: false, error };
    }
    const r = data?.SMSMessageData?.Recipients?.[0];
    if (r && ACCEPTED.has(Number(r.statusCode))) {
      logger?.info({ messageId: r.messageId, status: r.status }, 'SMS sent');
      return { sent: true, messageId: r.messageId ?? null };
    }
    const reason = r
      ? PROBLEMS[Number(r.statusCode)] || `Africa’s Talking said "${r.status}"`
      : data?.SMSMessageData?.Message || 'Africa’s Talking did not accept the message';
    logger?.warn({ statusCode: r?.statusCode, status: r?.status }, 'SMS not sent');
    return { sent: false, error: reason };
  } catch (err) {
    const error =
      err.name === 'AbortError'
        ? 'Africa’s Talking did not answer in time'
        : `could not reach Africa’s Talking (${err.message})`;
    logger?.warn({ err: err.message }, 'SMS not sent');
    return { sent: false, error };
  } finally {
    clearTimeout(timer);
  }
}
