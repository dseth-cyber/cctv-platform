import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './encryption.js';

describe('AES-256-GCM Encryption & Decryption [AUDIT-HIGH-06]', () => {
  it('should encrypt and decrypt plaintext password correctly', () => {
    const password = 'SuperSecretCameraPassword!123';
    const encrypted = encrypt(password);
    expect(encrypted).not.toBe(password);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(password);
  });

  it('should use a unique IV for each encryption call', () => {
    const password = 'same-password';
    const enc1 = encrypt(password);
    const enc2 = encrypt(password);
    expect(enc1).not.toBe(enc2);
    expect(enc1.split(':')[0]).not.toBe(enc2.split(':')[0]);
  });

  it('should throw an error on corrupted ciphertext or auth tag mismatch [AUDIT-HIGH-06]', () => {
    const password = 'CameraPassword';
    const encrypted = encrypt(password);
    const [iv, tag, data] = encrypted.split(':');

    // Tamper with the ciphertext data
    const corruptedData = (data.slice(0, -2) + (data.slice(-2) === 'aa' ? 'bb' : 'aa'));
    const tamperedCiphertext = `${iv}:${tag}:${corruptedData}`;

    // Should throw error and NEVER return tampered raw ciphertext
    expect(() => decrypt(tamperedCiphertext)).toThrow(/Decryption failed/i);
  });
});
