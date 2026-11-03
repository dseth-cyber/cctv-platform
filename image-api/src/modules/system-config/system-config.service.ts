import { getPrisma } from '../../lib/prisma.js';

const DEFAULT_CONFIGS: Record<string, { value: string; description: string; valueType: string; category: string }> = {
  // Auto-cleanup for operational/audit tables with no retention mechanism of their own
  // (see system-cleanup module, daily at 04:00). 0 = keep forever for that table.
  audit_logs_retention_days: { value: '180', description: 'Auto-delete Audit Log entries older than this many days. 0 = keep forever.', valueType: 'number', category: 'retention' },
  alerts_retention_days: { value: '60', description: 'Auto-delete resolved Alerts older than this many days (unresolved alerts are never auto-deleted). 0 = keep forever.', valueType: 'number', category: 'retention' },
  alert_critical_threshold: { value: '90', description: 'Disk usage percentage for critical alert', valueType: 'number', category: 'alert' },
  alert_warning_threshold: { value: '75', description: 'Disk usage percentage for warning alert', valueType: 'number', category: 'alert' },
  max_storage_gb: { value: '1000', description: 'Global max storage capacity in GB for forecast', valueType: 'number', category: 'storage' },
  camera_offline_threshold_minutes: { value: '5', description: 'Minutes without poll before camera is considered offline', valueType: 'number', category: 'alert' },
  camera_sla_target: { value: '99.5', description: 'Camera availability SLA target (%)', valueType: 'number', category: 'alert' },
  login_max_failed_attempts: { value: '5', description: 'Failed login attempts (per username) before temporary account lockout', valueType: 'number', category: 'alert' },
  login_failure_window_minutes: { value: '10', description: 'Time window for counting failed login attempts (minutes) — the counter resets after this long with no failures', valueType: 'number', category: 'alert' },
  login_lockout_minutes: { value: '15', description: 'How long an account stays locked after too many failed login attempts (minutes)', valueType: 'number', category: 'alert' },

  camera_auto_incident_enabled: { value: 'false', description: 'Automatically create an Incident when a camera goes offline (debounced by the offline threshold above)', valueType: 'boolean', category: 'automation' },
  camera_auto_resolve_enabled: { value: 'true', description: 'Automatically resolve an auto-created Incident when the camera comes back online', valueType: 'boolean', category: 'automation' },
  camera_auto_workorder_enabled: { value: 'false', description: 'Automatically create a Work Order when an auto-created Incident escalates to Critical', valueType: 'boolean', category: 'automation' },
  camera_incident_escalate_high_minutes: { value: '15', description: 'Minutes offline before an open auto-created Incident escalates to High priority', valueType: 'number', category: 'automation' },
  camera_incident_escalate_critical_minutes: { value: '30', description: 'Minutes offline before an open auto-created Incident escalates to Critical priority', valueType: 'number', category: 'automation' },
  camera_recovery_grace_minutes: { value: '1', description: 'Minutes a camera must stay reachable while "Recovering" before it is confirmed Online (prevents flapping). 1 = confirm on the very next check.', valueType: 'number', category: 'automation' },
  incident_attachment_max_mb: { value: '10', description: 'Maximum incident attachment file size (MB)', valueType: 'number', category: 'alert' },

  webhook_url: { value: '', description: 'Webhook URL to notify on events (camera offline/online, alerts)', valueType: 'string', category: 'general' },
  // Used to build clickable links in outbound notifications (currently: the incident
  // link in camera status-change Telegram/alert messages) — no trailing slash.
  public_base_url: { value: process.env.PUBLIC_BASE_URL || 'http://localhost:5173', description: 'Public URL the system is reachable at, used to build links in notifications (e.g. Telegram)', valueType: 'string', category: 'general' },
  webhook_secret: { value: '', description: 'Webhook secret for HMAC signature', valueType: 'string', category: 'general' },

  // General settings — managed via UI
  system_logo: { value: '', description: 'System logo (base64 data URL)', valueType: 'string', category: 'general' },
  system_name: { value: 'iSmart CCTV', description: 'Application name', valueType: 'string', category: 'general' },
  system_description: { value: 'Enterprise CCTV Management System', description: 'Application description', valueType: 'string', category: 'general' },
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
