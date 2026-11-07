import os from 'node:os';
import { getPrisma } from '../../lib/prisma.js';
import { ValidationError } from '../../lib/errors.js';
import { SECRET_MASK } from '../../lib/rtsp-credentials.js';

const DEFAULT_CONFIGS: Record<string, { value: string; description: string; valueType: string; category: string; min?: number; max?: number }> = {
  // Auto-cleanup for operational/audit tables with no retention mechanism of their own
  // (see system-cleanup module, daily at 04:00). 0 = keep forever for that table.
  audit_logs_retention_days: { value: '180', description: 'Auto-delete Audit Log entries older than this many days. 0 = keep forever.', valueType: 'number', category: 'retention', min: 0, max: 3650 },
  alerts_retention_days: { value: '60', description: 'Auto-delete resolved Alerts older than this many days (unresolved alerts are never auto-deleted). 0 = keep forever.', valueType: 'number', category: 'retention', min: 0, max: 3650 },
  alert_critical_threshold: { value: '90', description: 'Disk usage percentage for critical alert', valueType: 'number', category: 'alert', min: 1, max: 100 },
  alert_warning_threshold: { value: '75', description: 'Disk usage percentage for warning alert', valueType: 'number', category: 'alert', min: 1, max: 100 },
  max_storage_gb: { value: '1000', description: 'Global max storage capacity in GB for forecast', valueType: 'number', category: 'storage', min: 1, max: 1000000 },
  camera_offline_threshold_minutes: { value: '2', description: 'Minutes without poll before camera is considered offline', valueType: 'number', category: 'alert', min: 1, max: 1440 },
  camera_sla_target: { value: '99.5', description: 'Camera availability SLA target (%)', valueType: 'number', category: 'alert', min: 0, max: 100 },
  login_max_failed_attempts: { value: '5', description: 'Failed login attempts (per username) before temporary account lockout', valueType: 'number', category: 'alert', min: 1, max: 100 },
  login_failure_window_minutes: { value: '10', description: 'Time window for counting failed login attempts (minutes) — the counter resets after this long with no failures', valueType: 'number', category: 'alert', min: 1, max: 1440 },
  login_lockout_minutes: { value: '15', description: 'How long an account stays locked after too many failed login attempts (minutes)', valueType: 'number', category: 'alert', min: 1, max: 1440 },

  camera_auto_incident_enabled: { value: 'true', description: 'Automatically create an Incident when a camera goes offline (debounced by the offline threshold above)', valueType: 'boolean', category: 'automation' },
  camera_auto_resolve_enabled: { value: 'true', description: 'Automatically resolve an auto-created Incident when the camera comes back online', valueType: 'boolean', category: 'automation' },
  camera_auto_workorder_enabled: { value: 'false', description: 'Automatically create a Work Order when an auto-created Incident escalates to Critical', valueType: 'boolean', category: 'automation' },
  camera_incident_escalate_high_minutes: { value: '15', description: 'Minutes offline before an open auto-created Incident escalates to High priority', valueType: 'number', category: 'automation', min: 1, max: 10080 },
  camera_incident_escalate_critical_minutes: { value: '30', description: 'Minutes offline before an open auto-created Incident escalates to Critical priority', valueType: 'number', category: 'automation', min: 1, max: 10080 },
  camera_recovery_grace_minutes: { value: '1', description: 'Minutes a camera must stay reachable while "Recovering" before it is confirmed Online (prevents flapping). 1 = confirm on the very next check.', valueType: 'number', category: 'automation', min: 0, max: 60 },
  incident_attachment_max_mb: { value: '10', description: 'Maximum incident attachment file size (MB)', valueType: 'number', category: 'alert', min: 1, max: 100 },

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

  // Live Room limits: going over any of them slows the page down, it never overloads the server.
  live_max_streams_per_user: { value: '16', description: 'Live video tiles one viewer can have open at once; the rest show still images', valueType: 'number', category: 'live', min: 1, max: 64 },
  live_max_streams_total: { value: '64', description: 'Live video streams across all viewers; past this, viewers see still images', valueType: 'number', category: 'live', min: 1, max: 1000 },
  live_snapshot_refresh_seconds: { value: '30', description: 'How often still images are refreshed while someone is looking at them', valueType: 'number', category: 'live', min: 10, max: 600 },
  live_snapshot_stale_seconds: { value: '120', description: 'A still image older than this is flagged as out of date', valueType: 'number', category: 'live', min: 30, max: 3600 },
  live_snapshot_device_concurrency: { value: '3', description: 'Still images fetched at once from one camera or DVR/NVR', valueType: 'number', category: 'live', min: 1, max: 16 },
  live_snapshot_global_concurrency: { value: '16', description: 'Still images fetched at once in total', valueType: 'number', category: 'live', min: 1, max: 64 },
  // Never more than a quarter of this machine's memory, whatever is typed in.
  live_snapshot_cache_mb: { value: '128', description: 'Memory for still images; the ones asked for longest ago are dropped first', valueType: 'number', category: 'live', min: 16, max: Math.min(1024, Math.floor(os.totalmem() / 1048576 / 4)) },

  // Playback from a DVR/NVR's own HDD. A recorder has few playback slots, and it is also recording.
  playback_max_sessions_per_user: { value: '2', description: 'Recordings one viewer can play from recorders at once', valueType: 'number', category: 'live', min: 1, max: 8 },
  playback_max_sessions_per_device: { value: '2', description: 'Recordings played or copied from one DVR/NVR at once', valueType: 'number', category: 'live', min: 1, max: 8 },
  playback_max_sessions_total: { value: '16', description: 'Recordings played from all recorders at once', valueType: 'number', category: 'live', min: 1, max: 128 },
  // Never more than one per two CPU cores, whatever is typed in. 0 turns conversion off.
  playback_max_transcodes: { value: '2', description: 'H.265 recordings converted at once for browsers that cannot play them', valueType: 'number', category: 'live', min: 0, max: 16 },
  playback_clip_max_minutes: { value: '30', description: 'Longest clip copied from a recorder; it takes about as long as it lasts', valueType: 'number', category: 'live', min: 1, max: 120 },

  // Saved from Camera Analytics ("save as default layout").
  dashboard_layout_analytics: { value: '', description: 'Default Camera Analytics layout (JSON)', valueType: 'json', category: 'dashboard' },

  required_fields: { value: '{}', description: 'Required field configuration per entity (JSON)', valueType: 'json', category: 'general' },
};

const REQUIRED_FIELDS_KEY = 'required_fields';

// The only settings readable without a login: the login page needs them to draw itself.
const PUBLIC_CONFIG_KEYS = ['system_logo', 'system_name', 'system_description', 'system_version', 'system_copyright'];
const SECRET_CONFIG_KEYS = ['webhook_secret'];
const URL_CONFIG_KEYS = ['webhook_url', 'public_base_url'];
const MAX_LOGO_LENGTH = 2_000_000;
const MAX_JSON_LENGTH = 200_000;
const MAX_TEXT_LENGTH = 2_048;

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
      ...(def.min !== undefined ? { min: def.min, max: def.max } : {}),
    };
  }

  return map;
}

export async function getPublicConfigs(): Promise<Record<string, { value: unknown }>> {
  const all = await getAllConfigs();
  return Object.fromEntries(PUBLIC_CONFIG_KEYS.map((key) => [key, { value: all[key]?.value }]));
}

/** For the settings API: a stored secret comes back masked, and saving the mask means "unchanged". */
export async function getConfigsForClient(): Promise<Record<string, any>> {
  const all = await getAllConfigs();
  for (const key of SECRET_CONFIG_KEYS) {
    if (all[key]?.value) all[key].value = SECRET_MASK;
  }
  return all;
}

export interface ConfigProblem {
  key: string;
  reason: 'unknown' | 'not_number' | 'out_of_range' | 'not_boolean' | 'bad_json' | 'bad_url' | 'too_long' | 'order';
  min?: number;
  max?: number;
  /** For reason 'order': the setting this one has to stay below (or equal to). */
  other?: string;
}

/** Everything wrong with a save, so the form can show all of it at once. Pure; `current` holds the stored values. */
export function findConfigProblems(inputs: Record<string, string>, current: Record<string, { value: unknown }>): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  for (const [key, raw] of Object.entries(inputs)) {
    const def = DEFAULT_CONFIGS[key];
    if (!def) {
      problems.push({ key, reason: 'unknown' });
      continue;
    }
    const value = String(raw);
    if (def.valueType === 'number') {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n)) problems.push({ key, reason: 'not_number', min: def.min, max: def.max });
      else if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
        problems.push({ key, reason: 'out_of_range', min: def.min, max: def.max });
      }
    } else if (def.valueType === 'boolean') {
      if (value !== 'true' && value !== 'false') problems.push({ key, reason: 'not_boolean' });
    } else if (def.valueType === 'json') {
      if (value.length > MAX_JSON_LENGTH) problems.push({ key, reason: 'too_long' });
      else if (value !== '') {
        try {
          JSON.parse(value);
        } catch {
          problems.push({ key, reason: 'bad_json' });
        }
      }
    } else if (value.length > (key === 'system_logo' ? MAX_LOGO_LENGTH : MAX_TEXT_LENGTH)) {
      problems.push({ key, reason: 'too_long' });
    } else if (URL_CONFIG_KEYS.includes(key) && value !== '' && !/^https?:\/\/\S+$/i.test(value)) {
      problems.push({ key, reason: 'bad_url' });
    }
  }
  // Settings that only make sense in order, checked against what would be stored after this save.
  const effective = (key: string) => Number(inputs[key] ?? current[key]?.value);
  const inOrder: [string, string][] = [
    ['alert_warning_threshold', 'alert_critical_threshold'],
    ['camera_incident_escalate_high_minutes', 'camera_incident_escalate_critical_minutes'],
  ];
  for (const [lower, upper] of inOrder) {
    const changed = lower in inputs || upper in inputs;
    if (changed && effective(lower) > effective(upper) && !problems.some((p) => p.key === lower || p.key === upper)) {
      problems.push({ key: lower, reason: 'order', other: upper });
    }
  }
  return problems;
}

/** Saves all of it or none of it. Returns the keys written; a secret sent back masked is left as it was. */
export async function updateConfigs(inputs: Record<string, string>): Promise<string[]> {
  const prisma = getPrisma();
  const toSave = Object.fromEntries(
    Object.entries(inputs ?? {}).filter(([key, value]) => !(SECRET_CONFIG_KEYS.includes(key) && value === SECRET_MASK)),
  );
  const problems = findConfigProblems(toSave, await getAllConfigs());
  if (problems.length > 0) {
    throw new ValidationError(`Invalid settings: ${problems.map((p) => p.key).join(', ')}`, { code: 'CONFIG_INVALID', problems });
  }
  for (const [key, value] of Object.entries(toSave)) {
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
  return Object.keys(toSave);
}

function parseValue(raw: string, valueType: string): any {
  switch (valueType) {
    case 'number': return Number(raw);
    case 'boolean': return raw === 'true';
    case 'json': try { return JSON.parse(raw); } catch { return raw; }
    default: return raw;
  }
}
