import { formatDateTime } from './dateUtils'

export function getLocalizedValue(obj: any, lang: string): string {
  if (!obj) return ''
  if (typeof obj === 'string') return obj

  // Support masterdata entries with nameTh/nameEn/nameCn/nameMm/nameJp fields
  // Handle locale codes with country/region suffixes (e.g., 'th-TH', 'zh-CN')
  const cleanLang = (lang || '').split('-')[0].toLowerCase()
  const langMap: Record<string, string> = {
    th: 'nameTh',
    en: 'nameEn',
    cn: 'nameCn',
    zh: 'nameCn',
    mm: 'nameMm',
    my: 'nameMm',
    jp: 'nameJp',
    ja: 'nameJp'
  }
  const field = langMap[cleanLang]
  if (field && obj[field]) return obj[field]
  if (obj.nameEn) return obj.nameEn
  if (obj.nameTh) return obj.nameTh

  return obj[lang] || obj[cleanLang] || obj.en || ''
}

// Translate stored alert titles like "Camera offline: CAM-01" using i18n.
// Works for both old (already-stored English) and new alerts.
export function translateAlertTitle(title: string, t: (k: string, opts?: any) => string): string {
  if (!title) return ''

  const camera = title.match(/^Camera (offline|online|maintenance|error|inactive|deleted|created):\s*(.+)$/i)
  if (camera) {
    const status = camera[1].toLowerCase()
    const name = camera[2]
    const key = `imageService.alerts.titleCamera.${status}`
    const translated = t(key, { name })
    if (translated !== key) return translated
  }

  const storage = title.match(/^Storage (critical|warning|emergency):\s*(.+?)\s*(\([\d.]+%\))$/i)
  if (storage) {
    const level = storage[1].toLowerCase()
    const key = `imageService.alerts.titleStorage.${level}`
    const translated = t(key, { name: storage[2], pct: storage[3] })
    if (translated !== key) return translated
  }

  const authAnomaly = title.match(/^Suspicious login activity:\s*(.+)$/i)
  if (authAnomaly) {
    const key = 'imageService.alerts.titleAuthAnomaly'
    const translated = t(key, { username: authAnomaly[1] })
    if (translated !== key) return translated
  }

  const incidentUnassigned = title.match(/^Incident still unassigned:\s*(.+)$/i)
  if (incidentUnassigned) {
    const key = 'imageService.alerts.titleIncidentUnassigned'
    const translated = t(key, { number: incidentUnassigned[1] })
    if (translated !== key) return translated
  }

  const incidentCritical = title.match(/^Incident escalated to Critical:\s*(.+)$/i)
  if (incidentCritical) {
    const key = 'imageService.alerts.titleIncidentCritical'
    const translated = t(key, { number: incidentCritical[1] })
    if (translated !== key) return translated
  }

  // Recording storage alerts (retention-sweeper.service.ts / segment-indexer.ts) have fixed titles.
  const recordingKey = RECORDING_TITLE_KEYS[title]
  if (recordingKey) {
    const translated = t(recordingKey)
    if (translated !== recordingKey) return translated
  }

  return title
}

const RECORDING_TITLE_KEYS: Record<string, string> = {
  'Recording Storage Monitor Error': 'imageService.alerts.titleRecordingMonitorError',
  'Recording Storage High-Watermark Warning': 'imageService.alerts.titleRecordingWarning',
  'Recording Storage Critical — Cleanup Disabled': 'imageService.alerts.titleRecordingCriticalDisabled',
  'Emergency FIFO Eviction Triggered': 'imageService.alerts.titleRecordingEviction',
  'Emergency Eviction Did Not Free Space': 'imageService.alerts.titleRecordingEvictionIneffective',
  'Recording files missing from disk': 'imageService.alerts.titleRecordingMissing',
}

// Recognizes common technical failure text (connection timeouts, camera auth, full disk) and
// prepends a localized explanation while keeping the original text visible for
// troubleshooting. Falls back to the untouched original string when no known pattern matches.
export function translateTechnicalDetail(detail: string, t: (k: string, opts?: any) => string): string {
  if (!detail) return detail
  const s = detail.toLowerCase()
  let code: string | null = null
  if (/\b401\b|unauthorized|invalid credentials/.test(s)) code = 'authFailed'
  else if (/enospc|no space left|disk full/.test(s)) code = 'diskFull'
  else if (/etimedout|timed out|timeout|econnrefused|connection refused|ehostunreach|unreachable/.test(s)) code = 'unreachable'

  if (!code) return detail
  const key = `imageService.alerts.techError.${code}`
  const translated = t(key)
  return translated !== key ? `${translated} (${detail})` : detail
}

// Translates formatDuration()'s output ("1h 2m" / "16m 12s" / "42s") into the current
// language's unit words. The unit letter is glued directly to its digit (no \b boundary
// between them, since digits and letters are both word characters), so match on the
// digit group instead.
function translateDuration(value: string, t: (k: string, opts?: any) => string): string {
  return value
    .replace(/(\d+)h/g, (_, n) => `${n} ${t('imageService.alerts.unitHour', 'h')}`)
    .replace(/(\d+)m/g, (_, n) => `${n} ${t('imageService.alerts.unitMinute', 'm')}`)
    .replace(/(\d+)s/g, (_, n) => `${n} ${t('imageService.alerts.unitSecond', 's')}`)
}

// code -> localized label lookups for the masterdata-backed incident fields embedded in
// camera status-change messages (reason: incident_reason, resolution/rootCause:
// incident_resolution/incident_root_cause). Built by the caller (from GET
// /cameras/incidents/options, already loaded for the incident form) and passed in here;
// falls back to the raw code when not supplied/found.
export interface IncidentLabelMaps {
  reasons?: Record<string, string>
  resolutions?: Record<string, string>
  rootCauses?: Record<string, string>
}

// One line of the camera status-change message's optional detail tail (everything after
// "Camera "X" status changed to Y by Z. "), e.g. "Downtime: 1h 2m" or "Priority: high".
// Mirrors image-api/src/lib/telegram-translate-th.ts's parsing, kept in sync by hand
// since one runs server-side (fixed Thai output for Telegram) and this one runs
// client-side (per-viewer language via `t`).
function translateCameraDetailLine(part: string, t: (k: string, opts?: any) => string, labels?: IncidentLabelMaps): string {
  let m: RegExpMatchArray | null
  if ((m = part.match(/^Downtime:\s*(.+)$/))) return t('imageService.alerts.detailDowntime', { value: translateDuration(m[1], t) })
  if ((m = part.match(/^Incident\s+(\S+)\s+resolved\.?$/))) return t('imageService.alerts.detailIncidentResolved', { number: m[1] })
  if ((m = part.match(/^Incident\s+(\S+)\.?$/))) return t('imageService.alerts.detailIncident', { number: m[1] })
  if ((m = part.match(/^Reason:\s*(.+)$/))) return t('imageService.alerts.detailReason', { value: labels?.reasons?.[m[1]] ?? m[1] })
  if ((m = part.match(/^Priority:\s*(.+)$/))) {
    const key = `imageService.incidents.priority${m[1].charAt(0).toUpperCase()}${m[1].slice(1)}`
    const label = t(key) !== key ? t(key) : m[1]
    return t('imageService.alerts.detailPriority', { value: label })
  }
  if ((m = part.match(/^Impact:\s*(.+)$/))) {
    const key = `imageService.incidents.impact${m[1].charAt(0).toUpperCase()}${m[1].slice(1)}`
    const label = t(key) !== key ? t(key) : m[1]
    return t('imageService.alerts.detailImpact', { value: label })
  }
  if ((m = part.match(/^Details:\s*(.+)$/))) return t('imageService.alerts.detailNotes', { value: m[1] })
  if ((m = part.match(/^Resolution:\s*(.+)$/))) return t('imageService.alerts.detailResolution', { value: labels?.resolutions?.[m[1]] ?? m[1] })
  if ((m = part.match(/^RootCause:\s*(.+)$/))) return t('imageService.alerts.detailRootCause', { value: labels?.rootCauses?.[m[1]] ?? m[1] })
  if ((m = part.match(/^CorrectiveAction:\s*(.+)$/))) return t('imageService.alerts.detailCorrectiveAction', { value: m[1] })
  if ((m = part.match(/^PreventiveAction:\s*(.+)$/))) return t('imageService.alerts.detailPreventiveAction', { value: m[1] })
  if ((m = part.match(/^Notes:\s*(.+)$/))) return t('imageService.alerts.detailResolutionNotes', { value: m[1] })
  if ((m = part.match(/^Link:\s*(\S+)$/))) return t('imageService.alerts.detailLink', { url: m[1] })
  return part
}

// Translate the raw `message` field of an alert (shown alongside the title in the
// notification bell, alert detail modal, etc). Unlike the title, this field has no
// label prefix — it's just the raw backend message — so we only need to run the
// technical-detail classifier over it.
export function translateAlertMessage(message: string, t: (k: string, opts?: any) => string, labels?: IncidentLabelMaps, lang = 'th'): string {
  // A trailing "Live: <url>" line (camera alerts) is translated on its own; the rest is matched as before.
  const live = message.match(/\n\s*Live:\s*(\S+)\s*$/)
  if (live) return `${translateAlertMessage(message.slice(0, live.index).trimEnd(), t, labels, lang)}\n${t('imageService.alerts.detailLive', { url: live[1] })}`
  if (!message) return ''

  const cameraStatus = message.match(/^Camera "(.+?)" status changed to (\w+) by ([^.]+)\.?\s*([\s\S]*)$/)
  if (cameraStatus) {
    const [, cameraName, newStatus, changedBy, restRaw] = cameraStatus
    const statusKey = `imageService.cameras.${newStatus.toLowerCase()}`
    const statusLabel = t(statusKey) !== statusKey ? t(statusKey) : newStatus
    const baseKey = 'imageService.alerts.messageCameraStatus'
    let result = t(baseKey, { name: cameraName, status: statusLabel, user: changedBy })
    if (result === baseKey) result = message // key missing entirely — bail out to raw text

    const rest = restRaw.trim()
    if (rest) {
      const parts = rest.split('. ').map((s) => s.trim().replace(/\.$/, '')).filter(Boolean)
      result += '\n' + parts.map((p) => translateCameraDetailLine(p, t, labels)).join('\n')
    }
    return result
  }

  const cameraDeleted = message.match(/^Camera "(.+?)" was deleted by ([^.]+)(?:\. IP: (\S+))?$/)
  if (cameraDeleted) {
    const key = 'imageService.alerts.messageCameraDeleted'
    let translated = t(key, { name: cameraDeleted[1], user: cameraDeleted[2] })
    if (translated !== key) {
      if (cameraDeleted[3]) translated += ` (IP: ${cameraDeleted[3]})`
      return translated
    }
  }

  const cameraCreated = message.match(/^Camera "(.+?)" was created by ([^.]+)(?:\. IP: (\S+))?$/)
  if (cameraCreated) {
    const key = 'imageService.alerts.messageCameraCreated'
    let translated = t(key, { name: cameraCreated[1], user: cameraCreated[2] })
    if (translated !== key) {
      if (cameraCreated[3]) translated += ` (IP: ${cameraCreated[3]})`
      return translated
    }
  }

  // camera-health-monitor.ts's own auto-detected offline/online alerts — a different
  // message shape from the manual status-change one above (no incident/reason context,
  // fires from the poll-based watchdog rather than the resolve/incident form). The raw
  // ISO "Last poll" timestamp is reformatted in the viewer's language/locale rather than
  // shown as-is (was reported as "looking weird" untranslated).
  const autoOffline = message.match(/^Camera "(.+?)" is offline\.(?: The recorder (?:reports no video signal on this channel|cannot reach this camera)\.)? Status: (\w+)\. Last poll: (.+)$/i)
  if (autoOffline) {
    const [, name, status, lastPoll] = autoOffline
    const statusKey = `imageService.cameras.${status.toLowerCase()}`
    const statusLabel = t(statusKey) !== statusKey ? t(statusKey) : status
    const lastPollLabel = lastPoll.toLowerCase() === 'never' ? t('common.never', 'Never') : formatDateTime(lastPoll, lang)
    const key = 'imageService.alerts.messageCameraAutoOffline'
    const translated = t(key, { name, status: statusLabel, lastPoll: lastPollLabel })
    if (translated !== key) return translated
  }

  const streamDropped = message.match(/^Camera "(.+?)" stream disconnected instantly \(< 3s detection\)\. Stream: (.+?)\.?$/i)
  if (streamDropped) {
    const key = 'imageService.alerts.messageCameraStreamDropped'
    const translated = t(key, { name: streamDropped[1], path: streamDropped[2] })
    if (translated !== key) return translated
  }

  const autoOnline = message.match(/^Camera "(.+?)" is back online(?: via real-time webhook)?(?:\. Downtime: (.+))?$/i)
  if (autoOnline) {
    const [, name, downtime] = autoOnline
    const key = 'imageService.alerts.messageCameraAutoOnline'
    let translated = t(key, { name })
    if (translated !== key) {
      if (downtime) translated += ' ' + t('imageService.alerts.detailDowntime', { value: translateDuration(downtime, t) })
      return translated
    }
  }

  const authAnomaly = message.match(/^(\d+) failed login attempts for user "(.+?)"(?: from IP (\S+))? within (\d+) minute\(s\) — account locked for (\d+) minute\(s\)\.?$/i)
  if (authAnomaly) {
    const [, count, username, ip, windowMinutes, lockoutMinutes] = authAnomaly
    const key = 'imageService.alerts.messageAuthAnomaly'
    let translated = t(key, { count, username, windowMinutes, lockoutMinutes })
    if (translated !== key) {
      if (ip) translated += ' ' + t('imageService.alerts.messageAuthAnomalyIp', { ip })
      return translated
    }
  }

  const incidentUnassigned = message.match(/^Camera "(.+?)" has been offline for over (\d+) minute\(s\) and incident (\S+) has not been assigned to anyone yet\.?$/i)
  if (incidentUnassigned) {
    const key = 'imageService.alerts.messageIncidentUnassigned'
    const translated = t(key, { name: incidentUnassigned[1], minutes: incidentUnassigned[2], number: incidentUnassigned[3] })
    if (translated !== key) return translated
  }

  const incidentCritical = message.match(/^Camera "(.+?)" has been offline for over (\d+) minute\(s\)\.\s*Incident (\S+) needs attention\.?$/i)
  if (incidentCritical) {
    const key = 'imageService.alerts.messageIncidentCritical'
    const translated = t(key, { name: incidentCritical[1], minutes: incidentCritical[2], number: incidentCritical[3] })
    if (translated !== key) return translated
  }

  const storageUsage = message.match(/^(.+?) usage ([\d.]+ ?GB) \/ ([\d.]+ ?GB) \(([\d.]+)%\)(?:\s*exceeds \w+ threshold ([\d.]+)%)?$/i)
  if (storageUsage) {
    const [, name, used, total, pct, threshold] = storageUsage
    const key = 'imageService.alerts.messageStorageUsage'
    let translated = t(key, { name, used, total, pct })
    if (translated !== key) {
      if (threshold) {
        const exceedsKey = 'imageService.alerts.messageStorageExceeds'
        const exceeds = t(exceedsKey, { threshold })
        if (exceeds !== exceedsKey) translated += exceeds
      }
      return translated
    }
  }

  let m: RegExpMatchArray | null
  if ((m = message.match(/^Cannot read disk usage for recordings directory (.+?): ([\s\S]+)$/))) {
    return t('imageService.alerts.messageRecordingMonitorError', { dir: m[1], error: m[2] })
  }
  if ((m = message.match(/^Recording disk usage reached ([\d.]+)% \(Threshold: ([\d.]+)%\)/))) {
    return t('imageService.alerts.messageRecordingWarning', { pct: m[1], threshold: m[2] })
  }
  if ((m = message.match(/^Recording disk usage is critical at ([\d.]+)% \(Threshold: ([\d.]+)%\)\. Automatic cleanup is disabled/))) {
    return t('imageService.alerts.messageRecordingCriticalDisabled', { pct: m[1], threshold: m[2] })
  }
  if ((m = message.match(/^Recording disk usage is critical at ([\d.]+)% \(Threshold: ([\d.]+)%\)\. Deleting the oldest .+ until usage < ([\d.]+)%/))) {
    return t('imageService.alerts.messageRecordingEviction', { pct: m[1], threshold: m[2], target: m[3] })
  }
  if ((m = message.match(/^Deleted (\d+) recordings but usage is still ([\d.]+)%\. Something other than recordings is filling (.+?), or/))) {
    return t('imageService.alerts.messageRecordingEvictionIneffective', { count: m[1], pct: m[2], dir: m[3] })
  }
  if ((m = message.match(/^(\d+) indexed recording segment\(s\) are no longer on disk \((\d+) under Legal Hold\)/))) {
    return t('imageService.alerts.messageRecordingMissing', { count: m[1], onHold: m[2] })
  }

  return translateTechnicalDetail(message, t)
}

export function formatFileSize(bytes: number | bigint | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  const numBytes = Number(bytes);
  if (isNaN(numBytes) || numBytes < 0) return '—';
  if (numBytes === 0) return '0 B';

  if (numBytes < 1024) return `${numBytes} B`;
  if (numBytes < 1024 * 1024) return `${(numBytes / 1024).toFixed(2)} KB`;
  if (numBytes < 1024 * 1024 * 1024) return `${(numBytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(numBytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
