import crypto from 'node:crypto';

export interface DigestResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error('Response too large');
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('Response too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * HTTP Digest (what Hikvision and Dahua expect), falling back to Basic when the device asks for it.
 * The challenge round does not count as a failed login; a 401 returned here does.
 */
async function digestRequest(
  method: 'GET' | 'POST',
  url: string,
  username: string,
  password: string,
  opts: { timeoutMs: number; maxBytes: number },
  body?: string,
): Promise<DigestResponse> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const first = await fetch(url, { method, body, signal });
  if (first.status !== 401) {
    return { status: first.status, contentType: first.headers.get('content-type') ?? '', body: await readLimited(first, opts.maxBytes) };
  }
  await first.body?.cancel().catch(() => {});

  const challenge = first.headers.get('www-authenticate') ?? '';
  let authorization: string;
  if (/^digest/i.test(challenge)) {
    const param = (k: string) => challenge.match(new RegExp(`${k}="?([^",]+)"?`, 'i'))?.[1];
    const realm = param('realm') ?? '';
    const nonce = param('nonce') ?? '';
    const opaque = param('opaque');
    const qop = /\bauth\b/.test(param('qop') ?? '') ? 'auth' : undefined;
    const { pathname, search } = new URL(url);
    const uri = pathname + search;
    const ha1 = md5(`${username}:${realm}:${password}`);
    const ha2 = md5(`${method}:${uri}`);
    const cnonce = crypto.randomBytes(8).toString('hex');
    const nc = '00000001';
    const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    authorization = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`
      + (qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : '')
      + (opaque ? `, opaque="${opaque}"` : '');
  } else {
    authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  const second = await fetch(url, { method, body, signal, headers: { authorization } });
  return { status: second.status, contentType: second.headers.get('content-type') ?? '', body: await readLimited(second, opts.maxBytes) };
}

export function digestGet(url: string, username: string, password: string, opts: { timeoutMs: number; maxBytes: number }): Promise<DigestResponse> {
  return digestRequest('GET', url, username, password, opts);
}

/** For device queries sent as a POST body, such as searching a recorder's files. */
export function digestPost(url: string, username: string, password: string, body: string, opts: { timeoutMs: number; maxBytes: number }): Promise<DigestResponse> {
  return digestRequest('POST', url, username, password, opts, body);
}
