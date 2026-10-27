import { useTranslation } from 'react-i18next'

// Lightweight client-side mirror of the backend's actual policy (image-api/src/lib/
// password-policy.ts) — good enough for live feedback as the user types; the backend
// call remains the authoritative gate on submit (this list isn't kept byte-for-byte in
// sync, and doesn't need to be).
const COMMON_WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd',
  '12345678', '123456789', '1234567890', '11111111', '00000000', '123123123',
  'qwerty123', 'qwertyuiop', 'letmein', 'letmein123', 'welcome', 'welcome1',
  'admin123', 'administrator', 'iloveyou', 'monkey123', 'football', 'baseball',
  'changeme', 'changeme123', 'operator123', 'viewer123', 'camera123',
])

export type PasswordStrength = 0 | 1 | 2 | 3 | 4 // 0 = empty, 1 = weak, 2 = fair, 3 = good, 4 = strong

export function scorePasswordStrength(pw: string): PasswordStrength {
  if (!pw) return 0
  const normalized = pw.toLowerCase().trim().replace(/\d+$/, '')
  if (pw.length < 10 || COMMON_WEAK_PASSWORDS.has(pw.toLowerCase().trim()) || COMMON_WEAK_PASSWORDS.has(normalized)) {
    return 1
  }
  let variety = 0
  if (/[a-z]/.test(pw)) variety++
  if (/[A-Z]/.test(pw)) variety++
  if (/[0-9]/.test(pw)) variety++
  if (/[^a-zA-Z0-9]/.test(pw)) variety++

  if (pw.length >= 16 && variety >= 3) return 4
  if (pw.length >= 12 && variety >= 2) return 3
  return 2
}

const BAR_COLORS: Record<PasswordStrength, string> = {
  0: 'bg-white/10',
  1: 'bg-red-500',
  2: 'bg-amber-500',
  3: 'bg-lime-500',
  4: 'bg-emerald-500',
}

const TEXT_COLORS: Record<PasswordStrength, string> = {
  0: 'text-gray-400',
  1: 'text-red-400',
  2: 'text-amber-400',
  3: 'text-lime-400',
  4: 'text-emerald-400',
}

/** Live strength indicator for a password input — 4-segment bar + label, updates as `password` changes. Renders nothing when `password` is empty. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const { t } = useTranslation()
  if (!password) return null

  const score = scorePasswordStrength(password)
  const labelKey = ['', 'weak', 'fair', 'good', 'strong'][score]
  const label = t(`common.passwordStrength.${labelKey}`, labelKey)

  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((seg) => (
          <div key={seg} className={`h-1 flex-1 rounded-full transition-colors ${seg <= score ? BAR_COLORS[score] : 'bg-white/10'}`} />
        ))}
      </div>
      <p className={`text-[11px] mt-1 ${TEXT_COLORS[score]}`}>{label}</p>
    </div>
  )
}
