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

  const storageCleanup = title.match(/^Storage cleanup:\s*(.+)$/i)
  if (storageCleanup) {
    const key = 'imageService.alerts.titleStorageCleanup'
    const translated = t(key, { name: storageCleanup[1] })
    if (translated !== key) return translated
  }

  const authAnomaly = title.match(/^Suspicious login activity:\s*(.+)$/i)
  if (authAnomaly) {
    const key = 'imageService.alerts.titleAuthAnomaly'
    const translated = t(key, { username: authAnomaly[1] })
    if (translated !== key) return translated
  }

  const noNewImages = title.match(/^(Still no|No) new images:\s*(.+)$/i)
  if (noNewImages) {
    const key = noNewImages[1].toLowerCase() === 'still no'
      ? 'imageService.alerts.titleStillNoNewImages'
      : 'imageService.alerts.titleNoNewImages'
    const translated = t(key, { name: noNewImages[2] })
    if (translated !== key) return translated
  }

  const imagesResumed = title.match(/^Camera producing images again:\s*(.+)$/i)
  if (imagesResumed) {
    const key = 'imageService.alerts.titleImagesResumed'
    const translated = t(key, { name: imagesResumed[1] })
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

  // Sync worker errors carry arbitrary technical detail (SMB paths, NT_STATUS codes, IPs).
  // Known SMB failure codes get a translated explanation via translateTechnicalDetail;
  // anything unrecognized (raw paths, unknown codes) is left as-is since it isn't
  // meaningfully translatable.
  const syncWorker = title.match(/^Sync worker error:\s*(.+)$/i)
  if (syncWorker) {
    const key = 'imageService.alerts.titleSyncWorkerError'
    const translated = t(key, { detail: translateTechnicalDetail(syncWorker[1], t) })
    if (translated !== key) return translated
  }

  const trashEmptied = title.match(/^Trash emptied:\s*(\d+)\s*images$/i)
  if (trashEmptied) {
    const key = 'imageService.alerts.titleTrashEmptied'
    const translated = t(key, { count: trashEmptied[1] })
    if (translated !== key) return translated
  }

  const bulkDeleteFiles = title.match(/^Bulk delete files:\s*(\d+)\s*files$/i)
  if (bulkDeleteFiles) {
    const key = 'imageService.alerts.titleBulkDeleteFiles'
    const translated = t(key, { count: bulkDeleteFiles[1] })
    if (translated !== key) return translated
  }

  const bulkDelete = title.match(/^Bulk delete:\s*(\d+)\s*images$/i)
  if (bulkDelete) {
    const key = 'imageService.alerts.titleBulkDelete'
    const translated = t(key, { count: bulkDelete[1] })
    if (translated !== key) return translated
  }

  return title
}

// Recognizes common SMB/NT_STATUS failure codes embedded in raw technical error text
// (from smbclient, sync-worker scan failures, etc.) and prepends a Thai/localized
// explanation while keeping the original code visible for troubleshooting. Reuses the
// same classification keys as the camera "Test Connection" feature (smb.service.ts).
// Falls back to the untouched original string when no known pattern matches.
export function translateTechnicalDetail(detail: string, t: (k: string, opts?: any) => string): string {
  if (!detail) return detail
  const s = detail.toLowerCase()
  let code: string | null = null
  if (s.includes('nt_status_logon_failure') || s.includes('nt_status_wrong_password') || s.includes('nt_status_access_denied')) code = 'auth_failed'
  else if (s.includes('nt_status_bad_network_name')) code = 'share_not_found'
  else if (s.includes('nt_status_object_name_not_found') || s.includes('nt_status_object_path_not_found')) code = 'path_not_found'
  else if (s.includes('nt_status_host_unreachable') || s.includes('nt_status_io_timeout') || s.includes('connection timed out') || s.includes('timeout') || s.includes('connection refused')) code = 'unreachable'
  else if (s.includes('maximum call stack size exceeded') || s.includes('scan failed') || s.includes('stack overflow')) code = 'scan_overflow'

  if (!code) return detail
  const key = `imageService.cameras.smbError.${code}`
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

// Reuses the file-type labels from the Image Search page (imageService.search.fileType*)
// rather than duplicating them under alerts — metadata_json/ai/ocr aren't covered there
// (rare in a bulk-delete filter) so they fall back to the raw code.
const FILE_TYPE_KEY_MAP: Record<string, string> = {
  raw: 'imageService.search.fileTypeRaw', processed: 'imageService.search.fileTypeProcessed',
  thumbnail: 'imageService.search.fileTypeThumbnail',
}
function translateFileTypes(csv: string, t: (k: string, opts?: any) => string): string {
  return csv.split(',').map((s) => {
    const type = s.trim()
    const key = FILE_TYPE_KEY_MAP[type]
    if (!key) return type
    const label = t(key)
    return label !== key ? label : type
  }).join(', ')
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
  if (!message) return ''

  const trashEmptied = message.match(/^(.+?) permanently deleted (\d+)\/(\d+) images from trash \((\d+) files?, (\d+) failed and kept for retry\)$/i)
  if (trashEmptied) {
    const key = 'imageService.alerts.messageTrashEmptied'
    const translated = t(key, {
      user: trashEmptied[1], deleted: trashEmptied[2], total: trashEmptied[3],
      files: trashEmptied[4], errors: trashEmptied[5],
    })
    if (translated !== key) return translated
  }

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
  const autoOffline = message.match(/^Camera "(.+?)" is offline\. Status: (\w+)\. Last poll: (.+)$/i)
  if (autoOffline) {
    const [, name, status, lastPoll] = autoOffline
    const statusKey = `imageService.cameras.${status.toLowerCase()}`
    const statusLabel = t(statusKey) !== statusKey ? t(statusKey) : status
    const lastPollLabel = lastPoll.toLowerCase() === 'never' ? t('common.never', 'Never') : formatDateTime(lastPoll, lang)
    const key = 'imageService.alerts.messageCameraAutoOffline'
    const translated = t(key, { name, status: statusLabel, lastPoll: lastPollLabel })
    if (translated !== key) return translated
  }

  const autoOnline = message.match(/^Camera "(.+?)" is back online(?:\. Downtime: (.+))?$/i)
  if (autoOnline) {
    const [, name, downtime] = autoOnline
    const key = 'imageService.alerts.messageCameraAutoOnline'
    let translated = t(key, { name })
    if (translated !== key) {
      if (downtime) translated += ' ' + t('imageService.alerts.detailDowntime', { value: translateDuration(downtime, t) })
      return translated
    }
  }

  // The image-flow watchdog: reachable, but nothing coming out of it. Kept separate from
  // the offline messages above because the operator action is completely different —
  // there is nothing wrong with the network, so pointing them at it would waste their time.
  const noNewImages = message.match(/^Camera "(.+?)" is still reachable but has produced no new images for (.+?) \(last image: (\S+)\)(?: during an active production run for (.+?))?\. Only defective parts/i)
  if (noNewImages) {
    const [, name, silent, lastImage, run] = noNewImages
    const key = 'imageService.alerts.messageNoNewImages'
    let translated = t(key, { name, duration: translateDuration(silent, t), lastImage: formatDateTime(lastImage, lang) })
    if (translated !== key) {
      if (run) translated += ' ' + t('imageService.alerts.duringRun', { run })
      return translated
    }
  }

  const stillNoNewImages = message.match(/^Camera "(.+?)" has now produced no new images for (.+?) \(last image: (\S+)\)(?: during an active production run for (.+?))?\. It is still reachable/i)
  if (stillNoNewImages) {
    const [, name, silent, lastImage, run] = stillNoNewImages
    const key = 'imageService.alerts.messageStillNoNewImages'
    let translated = t(key, { name, duration: translateDuration(silent, t), lastImage: formatDateTime(lastImage, lang) })
    if (translated !== key) {
      if (run) translated += ' ' + t('imageService.alerts.duringRun', { run })
      return translated
    }
  }

  const imagesResumed = message.match(/^Camera "(.+?)" is producing images again after (.+?) with no new images\.?$/i)
  if (imagesResumed) {
    const key = 'imageService.alerts.messageImagesResumed'
    const translated = t(key, { name: imagesResumed[1], duration: translateDuration(imagesResumed[2], t) })
    if (translated !== key) return translated
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

  const storageCleanup = message.match(/^Auto-cleanup freed ([\d.]+ ?GB) \((\d+) files?\) for (.+?)\.?$/i)
  if (storageCleanup) {
    const key = 'imageService.alerts.messageStorageCleanup'
    const translated = t(key, { bytes: storageCleanup[1], count: storageCleanup[2], name: storageCleanup[3] })
    if (translated !== key) return translated
  }

  // Both bulk-delete shapes are built from a fixed template with exactly two day/"all"
  // variants and (files-only) an optional trailing failed-count clause — see
  // images.service.ts bulkDeleteFilesByAge/bulkDeleteByAge.
  const bulkDeleteFilesAged = message.match(/^(.+?) deleted (\d+) files \(types: ([^)]*)\) older than (\d+) days\. Filter: cameras=(\S+), age=(\S+)(?: \((\d+) failed, kept for retry\))?$/i)
  if (bulkDeleteFilesAged) {
    const [, user, count, types, days, cameras, age, errors] = bulkDeleteFilesAged
    const key = 'imageService.alerts.messageBulkDeleteFilesAged'
    let translated = t(key, { user, count, types: translateFileTypes(types, t), days, cameras, age })
    if (translated !== key) {
      if (errors) {
        const errKey = 'imageService.alerts.messageBulkDeleteErrorSuffix'
        const errText = t(errKey, { errors })
        if (errText !== errKey) translated += errText
      }
      return translated
    }
  }

  const bulkDeleteFilesAll = message.match(/^(.+?) deleted all (\d+) files \(types: ([^)]*)\)\. Filter: cameras=(\S+), age=(\S+)(?: \((\d+) failed, kept for retry\))?$/i)
  if (bulkDeleteFilesAll) {
    const [, user, count, types, cameras, age, errors] = bulkDeleteFilesAll
    const key = 'imageService.alerts.messageBulkDeleteFilesAll'
    let translated = t(key, { user, count, types: translateFileTypes(types, t), cameras, age })
    if (translated !== key) {
      if (errors) {
        const errKey = 'imageService.alerts.messageBulkDeleteErrorSuffix'
        const errText = t(errKey, { errors })
        if (errText !== errKey) translated += errText
      }
      return translated
    }
  }

  const bulkDeleteAged = message.match(/^(.+?) deleted (\d+) images older than (\d+) days\. Filter: cameras=(\S+), age=(\S+)$/i)
  if (bulkDeleteAged) {
    const [, user, count, days, cameras, age] = bulkDeleteAged
    const key = 'imageService.alerts.messageBulkDeleteAged'
    const translated = t(key, { user, count, days, cameras, age })
    if (translated !== key) return translated
  }

  const bulkDeleteAll = message.match(/^(.+?) deleted all (\d+) images\. Filter: cameras=(\S+), age=(\S+)$/i)
  if (bulkDeleteAll) {
    const [, user, count, cameras, age] = bulkDeleteAll
    const key = 'imageService.alerts.messageBulkDeleteAll'
    const translated = t(key, { user, count, cameras, age })
    if (translated !== key) return translated
  }

  return translateTechnicalDetail(message, t)
}

// Translate SMB test-connection results. The backend classifies failures into a
// stable `code` (auth_failed/share_not_found/path_not_found/unreachable/unknown)
// so the UI never has to render the raw smbclient/stderr text directly.
export function translateSmbTestResult(
  res: { success: boolean; message: string; code?: string },
  t: (k: string, opts?: any) => string,
): string {
  if (res.success) {
    const unc = res.message.match(/^Connected to (.+)$/)
    if (unc) {
      const translated = t('imageService.cameras.smbTestSuccess', { path: unc[1] })
      if (translated !== 'imageService.cameras.smbTestSuccess') return translated
    }
    return res.message
  }

  if (res.code && res.code !== 'unknown') {
    const key = `imageService.cameras.smbError.${res.code}`
    const translated = t(key)
    if (translated !== key) return translated
  }

  const key = 'imageService.cameras.smbError.unknown'
  const translated = t(key, { detail: res.message })
  return translated !== key ? translated : res.message
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
