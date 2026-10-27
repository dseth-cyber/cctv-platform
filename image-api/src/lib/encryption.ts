import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const key = config.encryptionKey;
  return crypto.createHash('sha256').update(key).digest();
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return '';
  const parts = ciphertext.split(':');
  // If not formatted as a 3-part GCM token (iv:tag:data), return as unencrypted legacy plaintext
  if (parts.length !== 3) return ciphertext;

  const [ivHex, authTagHex, encrypted] = parts;
  if (!ivHex || !authTagHex || !encrypted) return ciphertext;

  try {
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err: any) {
    throw new Error(`Decryption failed: corrupted ciphertext or invalid auth tag (${err?.message || 'auth failure'})`);
  }
}
