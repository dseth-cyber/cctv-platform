import { getPrisma } from '../../lib/prisma.js';

const DEFAULT_CONFIGS: Record<string, { value: string; description: string; valueType: string; category: string }> = {
  retention_days_raw: { value: '30', description: 'Retention days for raw TIFF files', valueType: 'number', category: 'retention' },
  retention_days_processed: { value: '90', description: 'Retention days for processed PNG files', valueType: 'number', category: 'retention' },
  retention_days_thumbnail: { value: '365', description: 'Retention days for thumbnail files', valueType: 'number', category: 'retention' },
  // Auto-cleanup for operational/audit tables with no retention mechanism of their own
  // (see system-cleanup module, daily at 04:00). 0 = keep forever for that table.
  processing_logs_retention_days: { value: '90', description: 'Auto-delete finished (completed/failed/dead-letter) Processing Log entries older than this many days. 0 = keep forever.', valueType: 'number', category: 'retention' },
  audit_logs_retention_days: { value: '180', description: 'Auto-delete Audit Log entries older than this many days. 0 = keep forever.', valueType: 'number', category: 'retention' },
  alerts_retention_days: { value: '60', description: 'Auto-delete resolved Alerts older than this many days (unresolved alerts are never auto-deleted). 0 = keep forever.', valueType: 'number', category: 'retention' },
  compression_quality: { value: '85', description: 'JPEG/PNG compression quality (0-100)', valueType: 'number', category: 'compression' },
  thumbnail_width: { value: '256', description: 'Thumbnail max width in pixels', valueType: 'number', category: 'thumbnail' },
  thumbnail_height: { value: '256', description: 'Thumbnail max height in pixels', valueType: 'number', category: 'thumbnail' },
  poll_interval_default: { value: '30', description: 'Default poll interval in seconds', valueType: 'number', category: 'polling' },
  scanner_max_files_per_cycle: { value: '100', description: 'Maximum files processed per camera poll cycle', valueType: 'number', category: 'polling' },
  retry_max_count: { value: '3', description: 'Max retry count for failed processing jobs', valueType: 'number', category: 'alert' },
  alert_critical_threshold: { value: '90', description: 'Disk usage percentage for critical alert', valueType: 'number', category: 'alert' },
  alert_warning_threshold: { value: '75', description: 'Disk usage percentage for warning alert', valueType: 'number', category: 'alert' },
  max_storage_gb: { value: '1000', description: 'Global max storage capacity in GB for forecast', valueType: 'number', category: 'storage' },
  max_storage_per_camera_gb: { value: '100', description: 'Per-camera max storage capacity in GB for forecast', valueType: 'number', category: 'storage' },
  dlq_alert_threshold: { value: '10', description: 'Dead letter queue count threshold for alert', valueType: 'number', category: 'alert' },
  camera_offline_threshold_minutes: { value: '5', description: 'Minutes without poll before camera is considered offline', valueType: 'number', category: 'alert' },
  camera_sla_target: { value: '99.5', description: 'Camera availability SLA target (%)', valueType: 'number', category: 'alert' },
  // Blind spot this closes (found 2026-08-21): camera_offline_threshold_minutes only asks
  // "can we still reach the camera?". A camera whose share stays reachable while its capture
  // software has stopped writing files looks perfectly healthy — TP27 sat silent for 23h
  // without a single alert. These watch the image flow itself, not the connection.
  camera_no_new_images_enabled: { value: 'true', description: 'Alert when a reachable camera stops producing new images', valueType: 'boolean', category: 'alert' },
  camera_no_new_images_threshold_minutes: { value: '120', description: 'Minutes without any new image from a reachable camera before raising an alert', valueType: 'number', category: 'alert' },
  camera_no_new_images_repeat_hours: { value: '6', description: 'Re-send the reminder every N hours while a camera is still producing nothing. 0 = notify once only', valueType: 'number', category: 'alert' },
  // Only defective parts are photographed here, so a quiet camera outside a scheduled run
  // means there is no work, not that anything is broken. Leave this on unless a camera is
  // expected to produce images with no production run recorded against it.
  camera_no_new_images_require_active_run: { value: 'true', description: 'Only alert about a silent camera while a production run is scheduled for it', valueType: 'boolean', category: 'alert' },
  // The camera PC overwrites its own oldest images once its disk fills, so ingestion has a
  // deadline. The usable window is disk capacity ÷ defect rate — not a fixed number of days —
  // so a rise in defects can shrink weeks of margin to hours without anyone noticing.
  ingest_buffer_warn_days: { value: '3', description: 'Warn when the oldest image still on a camera\'s own share is younger than this many days — that is how long we have to fetch before it is overwritten. 0 = off', valueType: 'number', category: 'alert' },
  login_max_failed_attempts: { value: '5', description: 'Failed login attempts (per username) before temporary account lockout', valueType: 'number', category: 'alert' },
  login_failure_window_minutes: { value: '10', description: 'Time window for counting failed login attempts (minutes) — the counter resets after this long with no failures', valueType: 'number', category: 'alert' },
  login_lockout_minutes: { value: '15', description: 'How long an account stays locked after too many failed login attempts (minutes)', valueType: 'number', category: 'alert' },

  camera_auto_incident_enabled: { value: 'false', description: 'Automatically create an Incident when a camera goes offline (debounced by the offline threshold above)', valueType: 'boolean', category: 'automation' },
  camera_auto_resolve_enabled: { value: 'true', description: 'Automatically resolve an auto-created Incident when the camera comes back online', valueType: 'boolean', category: 'automation' },
  camera_auto_workorder_enabled: { value: 'false', description: 'Automatically create a Work Order when an auto-created Incident escalates to Critical', valueType: 'boolean', category: 'automation' },
  camera_incident_escalate_high_minutes: { value: '15', description: 'Minutes offline before an open auto-created Incident escalates to High priority', valueType: 'number', category: 'automation' },
  camera_incident_escalate_critical_minutes: { value: '30', description: 'Minutes offline before an open auto-created Incident escalates to Critical priority', valueType: 'number', category: 'automation' },
  camera_recovery_grace_minutes: { value: '1', description: 'Minutes a camera must stay reachable while "Recovering" before it is confirmed Online (prevents flapping). 1 = confirm on the very next check.', valueType: 'number', category: 'automation' },
  camera_lost_image_cost: { value: '0', description: 'Estimated cost per lost image (THB)', valueType: 'number', category: 'alert' },
  incident_attachment_max_mb: { value: '10', description: 'Maximum incident attachment file size (MB)', valueType: 'number', category: 'alert' },
  dashboard_layout_overview: { value: '', description: 'Default dashboard layout for new users (JSON)', valueType: 'json', category: 'dashboard' },
  dashboard_layout_processing: { value: '', description: 'Default processing monitor layout for new users (JSON)', valueType: 'json', category: 'dashboard' },
  dashboard_layout_storage: { value: '', description: 'Default storage layout for new users (JSON)', valueType: 'json', category: 'dashboard' },

  webhook_url: { value: '', description: 'Webhook URL to notify on events (image processed, camera offline)', valueType: 'string', category: 'general' },
  // Used to build clickable links in outbound notifications (currently: the incident
  // link in camera status-change Telegram/alert messages) — no trailing slash.
  public_base_url: { value: 'https://images.lc.co.th', description: 'Public URL the system is reachable at, used to build links in notifications (e.g. Telegram)', valueType: 'string', category: 'general' },
  webhook_secret: { value: '', description: 'Webhook secret for HMAC signature', valueType: 'string', category: 'general' },

  // General settings — managed via UI
  system_logo: { value: '', description: 'System logo (base64 data URL)', valueType: 'string', category: 'general' },
  system_name: { value: 'Image Service', description: 'Application name', valueType: 'string', category: 'general' },
  system_description: { value: 'Enterprise Image Management System', description: 'Application description', valueType: 'string', category: 'general' },
  system_version: { value: '1.0.0', description: 'System version label', valueType: 'string', category: 'general' },
  system_developer: { value: 'Chiotron', description: 'Developer / company name', valueType: 'string', category: 'general' },
  system_copyright: { value: '© 2026 Chiotron. All rights reserved.', description: 'Copyright notice text', valueType: 'string', category: 'general' },

  required_fields: { value: '{}', description: 'Required field configuration per entity (JSON)', valueType: 'json', category: 'general' },
};

const REQUIRED_FIELDS_KEY = 'required_fields';

/** Read the parsed required-fields config object ({ "<entity>": ["field", ...] }). */
export async function getRequiredFields(): Promise<Record<string, string[]>> {
  const prisma = getPrisma();
  const row = await prisma.systemConfig.findUnique({ where: { key: REQUIRED_FIELDS_KEY } });
  const raw = row?.value ?? DEFAULT_CONFIGS[REQUIRED_FIELDS_KEY].value;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Persist the required-fields config object as a JSON string. */
export async function setRequiredFields(config: Record<string, string[]>): Promise<void> {
  const prisma = getPrisma();
  // Normalise: keep only arrays of non-empty strings.
  const clean: Record<string, string[]> = {};
  for (const [entity, fields] of Object.entries(config ?? {})) {
    if (Array.isArray(fields)) {
      clean[entity] = fields.filter((f): f is string => typeof f === 'string' && f.length > 0);
    }
  }
  const def = DEFAULT_CONFIGS[REQUIRED_FIELDS_KEY];
  await prisma.systemConfig.upsert({
    where: { key: REQUIRED_FIELDS_KEY },
    update: { value: JSON.stringify(clean) },
    create: {
      key: REQUIRED_FIELDS_KEY,
      value: JSON.stringify(clean),
      description: def.description,
      valueType: def.valueType,
      category: def.category,
    },
  });
}

export async function getAllConfigs(): Promise<Record<string, any>> {
  const prisma = getPrisma();
  const rows = await prisma.systemConfig.findMany();
  const map: Record<string, any> = {};

  for (const [key, def] of Object.entries(DEFAULT_CONFIGS)) {
    const row = rows.find(r => r.key === key);
    const raw = row?.value ?? def.value;
    map[key] = {
      value: parseValue(raw, row?.valueType ?? def.valueType),
      description: row?.description ?? def.description,
      valueType: row?.valueType ?? def.valueType,
      category: row?.category ?? def.category,
    };
  }

  return map;
}

export async function updateConfigs(inputs: Record<string, string>): Promise<void> {
  const prisma = getPrisma();
  for (const [key, value] of Object.entries(inputs)) {
    const def = DEFAULT_CONFIGS[key];
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value: String(value) },
      create: {
        key,
        value: String(value),
        description: def?.description ?? '',
        valueType: def?.valueType ?? 'string',
        category: def?.category ?? 'general',
      },
    });
  }
}

function parseValue(raw: string, valueType: string): any {
  switch (valueType) {
    case 'number': return Number(raw);
    case 'boolean': return raw === 'true';
    case 'json': try { return JSON.parse(raw); } catch { return raw; }
    default: return raw;
  }
}
