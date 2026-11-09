import { describe, expect, it, vi } from 'vitest';
import { liveLinkLine } from './live-link.js';

const base = { value: '' as unknown };
vi.mock('../system-config/system-config.service.js', () => ({ getAllConfigs: vi.fn(async () => ({ public_base_url: base })) }));

describe('liveLinkLine', () => {
  it('links the camera full screen on the live wall', async () => {
    base.value = 'http://192.168.30.77:8090/';
    expect(await liveLinkLine('cam-1')).toBe('\nLive: http://192.168.30.77:8090/cctv/live-grid?focus=cam-1');
  });

  it('adds nothing without a usable address', async () => {
    base.value = '';
    expect(await liveLinkLine('cam-1')).toBe('');
    base.value = 'not a url';
    expect(await liveLinkLine('cam-1')).toBe('');
  });
});
