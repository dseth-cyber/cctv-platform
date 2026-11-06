import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

describe('MediaMTX Configuration Validator', () => {
  const configPath = path.resolve(__dirname, '../../../../mediamtx/mediamtx.yml');

  it('should exist and parse valid YAML', () => {
    expect(fs.existsSync(configPath)).toBe(true);
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(content);
    expect(parsed).toBeDefined();
  });

  it('should have hlsSegmentCount >= 7 when hlsVariant is lowLatency [AUDIT-CRIT-01]', () => {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(content);
    // MediaMTX v1.21+ requires hlsSegmentCount to be at least 7 for lowLatency
    expect(parsed.hlsSegmentCount).toBeGreaterThanOrEqual(7);
  });

  it('should target image-api:3001 in authHTTPAddress matching docker-compose service [AUDIT-CRIT-02]', () => {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(content);
    expect(parsed.authHTTPAddress).toBe('http://image-api:3001/api/v1/media/auth');
  });

  it('gives every runOnDemand path an explicit publisher source (else every API path add is refused)', () => {
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf8'));
    for (const [name, p] of Object.entries<any>(parsed.paths ?? {})) {
      if (p?.runOnDemand || p?.runOnUnDemand) expect({ name, source: p.source }).toEqual({ name, source: 'publisher' });
    }
  });

  it('pulls cameras over TCP (the UDP fallback cuts off viewers of on-demand streams)', () => {
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.pathDefaults.rtspTransport).toBe('tcp');
  });

  it('never lets MediaMTX delete recordings itself (retention and Legal Hold own deletion)', () => {
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf8'));
    // MediaMTX defaults recordDeleteAfter to 1d, which silently removed held and quarantined segments.
    expect(parsed.pathDefaults.recordDeleteAfter).toBe('0s');
  });
});
