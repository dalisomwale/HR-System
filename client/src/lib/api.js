/**
 * API client. Same-origin requests carry the session cookie; every change also carries the
 * CSRF token issued at sign-in. No role or identity decisions are made here: the server
 * checks everything.
 */
let csrfToken = null;
export const setCsrfToken = (t) => {
  csrfToken = t;
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status}).`);
    this.status = status;
    this.code = body?.error?.code;
    this.fields = body?.error?.fields ?? [];
    this.details = body?.error?.details;
  }
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: { message: 'The server could not be reached. Check your connection.' } });
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    // 502/503/504 without our JSON error body means the API itself is not answering.
    if ([502, 503, 504].includes(res.status) && !data?.error) {
      throw new ApiError(res.status, {
        error: {
          message:
            'The leave system server is not running or not reachable. If you are running it locally, check the terminal for errors.',
        },
      });
    }
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.location.assign('/sign-in?error=session_ended');
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

/** Build a query string, leaving out empty values. */
export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
}
