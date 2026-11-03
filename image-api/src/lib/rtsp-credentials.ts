import { encrypt, decrypt } from './encryption.js';

/**
 * Camera RTSP URLs often embed credentials, either as userinfo (rtsp://user:pass@host)
 * or as vendor path/query params (e.g. /user=admin&password=xxx&channel=1).
 * Per AGENTS.md rule 8 they must never be stored as plaintext in the DB nor returned by the API.
 */

export const SECRET_MASK = '********';

const CREDENTIAL_PARAM_RE = /((?:^|[?&;/])(?:password|passwd|pwd|pass)=)[^&;/]*/gi;
const USERINFO_RE = /^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i;
// encrypt() output is iv(16 bytes):authTag(16 bytes):data, all hex. Matching the exact shape matters:
// decrypt() treats any 3-part value as ciphertext, and "rtsp://host:554/path" also splits into 3 parts.
const SEALED_RE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i;

function unseal(stored: string): string {
  return SEALED_RE.test(stored) ? decrypt(stored) : stored;
}

function hasCredentials(url: string): boolean {
  CREDENTIAL_PARAM_RE.lastIndex = 0;
  return USERINFO_RE.test(url) || CREDENTIAL_PARAM_RE.test(url);
}

/** Encrypt an RTSP URL for storage when it carries credentials; credential-free URLs are stored as-is. */
export function sealRtspUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  if (isMaskedRtspUrl(url)) {
    throw new Error('Refusing to store a redacted RTSP URL');
  }
  return hasCredentials(url) ? encrypt(url) : url;
}

/** Decrypt a stored RTSP URL. Legacy plaintext rows pass through unchanged. */
export function openRtspUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return unseal(stored);
}

/** Strip credentials so the URL is safe to return to clients or write to logs. */
export function redactRtspUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  let url: string;
  try {
    url = unseal(stored);
  } catch {
    return null;
  }
  return url
    .replace(USERINFO_RE, `$1${SECRET_MASK}@`)
    .replace(CREDENTIAL_PARAM_RE, `$1${SECRET_MASK}`);
}

/** True when a client echoed back a redacted URL (e.g. an edit form resubmitting unchanged fields). */
export function isMaskedRtspUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.includes(SECRET_MASK));
}

/** The password inside a stored RTSP URL (userinfo or a password= path/query param), or null. */
export function extractRtspPassword(stored: string | null | undefined): string | null {
  const url = openRtspUrl(stored);
  if (!url) return null;
  const userinfo = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/@:]*:([^/@]*)@/i);
  const param = userinfo ? null : url.match(/(?:^|[?&;/])(?:password|passwd|pwd|pass)=([^&;/]*)/i);
  const raw = userinfo?.[1] ?? param?.[1];
  if (raw === undefined) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
