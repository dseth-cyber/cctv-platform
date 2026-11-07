import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { findConfigProblems, getConfigsForClient, getPublicConfigs, updateConfigs } from './system-config.service.js';

const stored = (rows: { key: string; value: string }[] = []) => {
  const upsert = vi.fn().mockResolvedValue({});
  vi.mocked(getPrisma).mockReturnValue({ systemConfig: { findMany: vi.fn().mockResolvedValue(rows), upsert } } as any);
  return upsert;
};

const current = { alert_warning_threshold: { value: 75 }, alert_critical_threshold: { value: 90 } };

describe('findConfigProblems', () => {
  it('accepts valid values', () => {
    expect(findConfigProblems({ camera_sla_target: '99.5', webhook_url: 'https://x.test/hook', required_fields: '{}' }, current)).toEqual([]);
  });

  it('reports the range so the form can explain it', () => {
    expect(findConfigProblems({ login_max_failed_attempts: '0' }, current)).toEqual([
      { key: 'login_max_failed_attempts', reason: 'out_of_range', min: 1, max: 100 },
    ]);
  });

  it('refuses unknown keys, text in number fields and broken JSON', () => {
    expect(findConfigProblems({ nope: '1' }, current)[0].reason).toBe('unknown');
    expect(findConfigProblems({ camera_sla_target: 'abc' }, current)[0].reason).toBe('not_number');
    expect(findConfigProblems({ camera_sla_target: ' ' }, current)[0].reason).toBe('not_number');
    expect(findConfigProblems({ required_fields: '[object Object]' }, current)[0].reason).toBe('bad_json');
    expect(findConfigProblems({ webhook_url: 'ftp://x' }, current)[0].reason).toBe('bad_url');
  });

  it('checks settings that depend on each other against the stored value', () => {
    expect(findConfigProblems({ alert_warning_threshold: '95' }, current)).toEqual([
      { key: 'alert_warning_threshold', reason: 'order', other: 'alert_critical_threshold' },
    ]);
    expect(findConfigProblems({ alert_warning_threshold: '95', alert_critical_threshold: '99' }, current)).toEqual([]);
  });
});

describe('system config access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes only branding and the watermark switch without a login', async () => {
    stored([{ key: 'webhook_secret', value: 'topsecret' }]);
    const pub = await getPublicConfigs();
    expect(Object.keys(pub).sort()).toEqual(['system_copyright', 'system_description', 'system_logo', 'system_name', 'system_version', 'watermark_enabled']);
    expect(JSON.stringify(pub)).not.toContain('topsecret');
  });

  it('masks a stored secret for the settings page', async () => {
    stored([{ key: 'webhook_secret', value: 'topsecret' }]);
    expect((await getConfigsForClient()).webhook_secret.value).toBe('********');
  });

  it('keeps the stored secret when the mask is saved back', async () => {
    const upsert = stored();
    expect(await updateConfigs({ webhook_secret: '********', camera_sla_target: '99' })).toEqual(['camera_sla_target']);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when any value is invalid', async () => {
    const upsert = stored();
    await expect(updateConfigs({ camera_sla_target: '99', login_lockout_minutes: '-1' })).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'CONFIG_INVALID' },
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});
