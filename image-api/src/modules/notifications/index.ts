import { logger } from '../../lib/logger.js';
import { getRedisClient } from '../../lib/redis.js';
import { sendTelegramAlert } from './telegram.js';
import { sendLineAlert } from './line.js';

const COOLDOWN_PREFIX = 'notify:cooldown:';

// Fallback only, for when Redis is unreachable. This used to be the *only* store, which
// meant every image-api restart wiped every cooldown: found 2026-08-22 after a day of
// deploys, a rule set to 1440 minutes still notified roughly hourly, because each
// restart handed it a clean slate. Redis outlives the process, so the window now means
// what the rule says it means.
const cooldownMap = new Map<string, number>();

async function isOnCooldown(key: string, cooldownMinutes: number): Promise<boolean> {
  if (cooldownMinutes <= 0) return false;
  try {
    return (await getRedisClient().exists(COOLDOWN_PREFIX + key)) === 1;
  } catch (err) {
    logger.error({ err, key }, 'Cooldown lookup failed — falling back to in-memory window');
    const lastSent = cooldownMap.get(key);
    if (!lastSent) return false;
    return (Date.now() - lastSent) / 1000 / 60 < cooldownMinutes;
  }
}

/** The key expires on its own, so a rule's cooldown shrinking later can't leave a stale lock behind. */
async function markCooldown(key: string, cooldownMinutes: number): Promise<void> {
  if (cooldownMinutes <= 0) return;
  try {
    await getRedisClient().setex(COOLDOWN_PREFIX + key, Math.round(cooldownMinutes * 60), String(Date.now()));
  } catch (err) {
    logger.error({ err, key }, 'Cooldown write failed — recording in memory only');
    cooldownMap.set(key, Date.now());
  }
}

export async function notifyChannels(opts: {
  title: string;
  message: string;
  severity: string;
  channels: string[];
  ruleId?: string;
  cooldownMinutes?: number;
  source?: string;
  // Deliberate one-off admin actions (camera created/deleted) should never be silently
  // swallowed by the flapping-camera cooldown below — found 2026-08-08: a test camera
  // reusing the same id across repeated delete/recreate cycles hit the same
  // rule:source:severity cooldown key and only the first delete in the window actually
  // notified. Set true to always send and skip touching the cooldown timestamp
  // entirely, so it doesn't interfere with cooldown-tracked status-change events that
  // happen to share the same key.
  bypassCooldown?: boolean;
}): Promise<void> {
  const { title, message, severity, channels, ruleId, cooldownMinutes, source, bypassCooldown } = opts;

  // Cooldown is scoped per (rule, source, severity), not just the rule — a rule like
  // "Camera Offline Alert" fires for both the offline (critical) and the recovery
  // (info) transition of the *same* camera, sharing one alertType. Keying on ruleId
  // alone meant the recovery notification for camera X was silently swallowed by the
  // cooldown the offline notification for that same camera had just started (found
  // 2026-08-07: testing offline→online within the 60min window never delivered the
  // "back online" message). Including source+severity still throttles repeats of the
  // *same* state (e.g. a flapping camera), just not a genuinely different transition.
  const cooldownKey = ruleId ? `${ruleId}:${source ?? 'global'}:${severity}` : undefined;

  if (!bypassCooldown && cooldownKey && cooldownMinutes && await isOnCooldown(cooldownKey, cooldownMinutes)) {
    logger.info({ ruleId, source, severity }, 'Notification skipped — within cooldown window');
    return;
  }

  const results = await Promise.allSettled(
    channels.map(async (ch) => {
      switch (ch) {
        case 'telegram':
          return sendTelegramAlert(title, message, severity);
        case 'line':
          return sendLineAlert(title, message, severity);
        default:
          logger.warn({ channel: ch }, 'Unknown notification channel');
          return false;
      }
    }),
  );

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      logger.error({ channel: channels[i], err: r.reason }, 'Notification channel failed');
    }
  });

  if (!bypassCooldown && cooldownKey && cooldownMinutes && results.some((r) => r.status === 'fulfilled' && r.value)) {
    await markCooldown(cooldownKey, cooldownMinutes);
  }
}
