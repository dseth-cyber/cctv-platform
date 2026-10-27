const LOCALE_MAP: Record<string, string> = {
  th: 'th-TH',
  en: 'en-GB',
  cn: 'zh-CN',
  jp: 'ja-JP',
  mm: 'my-MM',
}

const CALENDAR_MAP: Record<string, string> = {
  th: 'buddhist',
}

function getLocale(lang: string) {
  return LOCALE_MAP[lang] ?? 'en-GB'
}

function getOptions(lang: string, base: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  const calendar = CALENDAR_MAP[lang]
  return calendar ? { ...base, calendar } : base
}

export function formatDateTime(dateStr: string | Date, lang = 'th'): string {
  if (!dateStr) return ''
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  if (isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString(getLocale(lang), getOptions(lang, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }))
  } catch {
    return d.toLocaleString('en-GB')
  }
}

export function formatDate(dateStr: string | Date, lang = 'th'): string {
  if (!dateStr) return ''
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  if (isNaN(d.getTime())) return ''
  try {
    return d.toLocaleDateString(getLocale(lang), getOptions(lang, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }))
  } catch {
    return d.toLocaleDateString('en-GB')
  }
}

export function formatTime(dateStr: string | Date, lang = 'th'): string {
  if (!dateStr) return ''
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  if (isNaN(d.getTime())) return ''
  try {
    return d.toLocaleTimeString(getLocale(lang), { hour: '2-digit', minute: '2-digit' })
  } catch {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
}

export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
