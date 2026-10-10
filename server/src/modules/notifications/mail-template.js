/**
 * Plain, branded email with a plain-text alternative. Content is limited by design (brief s.12):
 * reference, leave type (never a confidential one), dates, status, the action needed and a link.
 * No medical details, comments, attachments or other people's balances.
 */

const NAVY = '#000080';

const escape = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * @param {object} m
 * @param {string} m.greetingName  recipient's first name
 * @param {string} m.heading       one line, e.g. "Leave request to review"
 * @param {string} m.intro         one or two sentences
 * @param {Array<[string,string]>} m.rows  label / value pairs
 * @param {string} [m.action]      what the recipient should do
 * @param {string} [m.url]         absolute link into the system
 */
export function renderEmail({ greetingName, heading, intro, rows = [], action, url }) {
  const text = [
    `Dear ${greetingName},`,
    '',
    intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(action ? ['', action] : []),
    ...(url ? ['', `Open in the leave system: ${url}`] : []),
    '',
    '--',
    'Altus Financial Services Limited - Leave Management',
    'This message was sent automatically. Do not reply to it.',
  ].join('\r\n');

  const rowHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#5b6475;white-space:nowrap;vertical-align:top">${escape(k)}</td><td style="padding:4px 0;color:#1d2433;font-weight:600">${escape(v)}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dce1e8;border-top:4px solid ${NAVY}">
<tr><td style="padding:20px 24px 8px 24px;font-size:16px;font-weight:700;color:${NAVY}">Altus Financial Services Limited<span style="font-weight:400;color:#5b6475"> &middot; Leave Management</span></td></tr>
<tr><td style="padding:8px 24px 0 24px"><h1 style="margin:0;font-size:19px;color:#1d2433">${escape(heading)}</h1></td></tr>
<tr><td style="padding:12px 24px 0 24px">
<p style="margin:0 0 12px 0">Dear ${escape(greetingName)},</p>
<p style="margin:0 0 16px 0">${escape(intro)}</p>
${rowHtml ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;font-size:14px">${rowHtml}</table>` : ''}
${action ? `<p style="margin:0 0 16px 0">${escape(action)}</p>` : ''}
${url ? `<p style="margin:0 0 20px 0"><a href="${escape(url)}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600">Open in the leave system</a></p>` : ''}
</td></tr>
<tr><td style="padding:12px 24px 20px 24px;border-top:1px solid #dce1e8;font-size:12px;color:#5b6475">This message was sent automatically by the Altus leave system. Do not reply to it.</td></tr>
</table></td></tr></table></body></html>`;

  return { html, text };
}

/**
 * RFC 5322 message with text and HTML alternatives, for Graph's MIME sendMail.
 * Header values are encoded so no input can add a header.
 */
export function buildMime({ from, to, subject, html, text }) {
  const boundary = `altus-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject.replace(/[\r\n]+/g, ' '), 'utf8').toString('base64')}?=`;
  const safeAddress = (a) => String(a).replace(/[\r\n<>,;"]/g, '');
  return [
    `From: ${safeAddress(from)}`,
    `To: ${safeAddress(to)}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
