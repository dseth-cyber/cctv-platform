import { z } from 'zod';

// NIST 800-63B recommends checking new passwords against known-compromised/common
// values over forcing arbitrary complexity rules (which mostly just produces
// predictable patterns like "Password1!" and encourages reuse/write-it-down habits).
// This is a small curated list, not a full breached-password database — good enough to
// catch the "admin123"-style mistake this was added after, not a substitute for a
// proper HaveIBeenPwned-style check if that's ever warranted.
const COMMON_WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd',
  '12345678', '123456789', '1234567890', '11111111', '00000000', '123123123',
  'qwerty123', 'qwertyuiop', 'letmein', 'letmein123', 'welcome', 'welcome1',
  'admin123', 'administrator', 'iloveyou', 'monkey123', 'football', 'baseball',
  'dragon123', 'master123', 'sunshine', 'princess', 'trustno1', 'abc123456',
  'changeme', 'changeme123', 'operator123', 'viewer123', 'camera123',
]);

function isWeakPassword(pw: string): boolean {
  const normalized = pw.toLowerCase().trim();
  if (COMMON_WEAK_PASSWORDS.has(normalized)) return true;
  // Strip a trailing run of digits ("welcome2026" -> "welcome") and re-check — catches
  // the extremely common "word + year/number" pattern without needing every variant
  // listed explicitly.
  const stripped = normalized.replace(/\d+$/, '');
  return stripped !== normalized && COMMON_WEAK_PASSWORDS.has(stripped);
}

// Length over complexity rules, per the same NIST guidance — a longer passphrase is
// both easier to remember and harder to brute-force than a short "complex" one.
export const strongPasswordSchema = z.string().min(10).max(256).refine(
  (pw) => !isWeakPassword(pw),
  { message: 'This password is too common/easily guessed — choose a less predictable one' },
);
