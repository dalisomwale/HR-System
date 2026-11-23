import { describe, it, expect } from 'vitest';
import { sendSms, smsEnabled } from '../src/modules/notifications/sms.js';

/*
 * Text messages through Africa's Talking (D127). Africa's Talking's API is stood in for by a
 * fake fetch that answers the way the real one does.
 */
const AT = { provider: 'africastalking', username: 'altus', apiKey: 'key-123', senderId: 'ALTUS' };
const reply = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const recipient = (statusCode, status) => ({
  SMSMessageData: { Message: 'Sent to 1/1', Recipients: [{ statusCode, status, number: '+260971234567', messageId: 'ATXid_1' }] },
});

describe('sending a text message (D127)', () => {
  it('is off unless Africa’s Talking is set up', async () => {
    expect(smsEnabled({ provider: 'disabled' })).toBe(false);
    expect(smsEnabled({ ...AT, apiKey: undefined })).toBe(false);
    expect(smsEnabled(AT)).toBe(true);
    expect(await sendSms({ provider: 'disabled' }, { to: '+260971234567', message: 'x' })).toMatchObject({ sent: false });
  });

  it('posts the number, message and sender name to Africa’s Talking', async () => {
    let call;
    const fetchImpl = async (url, opts) => {
      call = { url, opts };
      return reply(201, recipient(101, 'Success'))();
    };
    const r = await sendSms(AT, { to: '+260971234567', message: 'Code 12345678' }, { fetchImpl });
    expect(r).toEqual({ sent: true, messageId: 'ATXid_1' });
    expect(call.url).toBe('https://api.africastalking.com/version1/messaging');
    expect(call.opts.headers.apiKey).toBe('key-123');
    const body = new URLSearchParams(call.opts.body);
    expect(Object.fromEntries(body)).toEqual({ username: 'altus', to: '+260971234567', message: 'Code 12345678', from: 'ALTUS' });
  });

  it('uses the sandbox for the "sandbox" username', async () => {
    let url;
    await sendSms({ ...AT, username: 'sandbox' }, { to: '+260971234567', message: 'x' }, {
      fetchImpl: async (u) => {
        url = u;
        return reply(201, recipient(100, 'Processed'))();
      },
    });
    expect(url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
  });

  it('explains why a message was not sent', async () => {
    const send = (fetchImpl) => sendSms(AT, { to: '+260971234567', message: 'x' }, { fetchImpl });
    expect(await send(reply(201, recipient(405, 'InsufficientBalance')))).toEqual({
      sent: false,
      error: 'the Africa’s Talking account has no credit left',
    });
    expect((await send(reply(201, recipient(402, 'InvalidSenderId')))).error).toMatch(/sender name/);
    expect((await send(reply(401, 'The supplied authentication is invalid'))).error).toMatch(/username or API key/);
    expect(
      (await send(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      })).error,
    ).toMatch(/could not reach/);
    expect(await sendSms(AT, { to: '0971234567', message: 'x' })).toEqual({ sent: false, error: 'the phone number is not valid' });
  });
});
