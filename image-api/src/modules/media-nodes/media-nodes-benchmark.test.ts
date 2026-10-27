import { describe, it, expect } from 'vitest';
import { MediaNodesService } from './media-nodes.service.js';

describe('Capacity Benchmark & Sizing Calculator', () => {
  it('calculates H.264 capacity with 20% free-space headroom and RAID-5 overhead', () => {
    const res = MediaNodesService.calculateBenchmark({
      channelCount: 100,
      codec: 'h264',
      retentionDays: 7,
      raidType: 'raid5',
      freeSpaceHeadroomPercent: 20,
    });

    expect(res.codec).toBe('h264');
    expect(res.channelCount).toBe(100);
    expect(res.ingress.bitrateMbps).toBe(200); // 100 * 2048 / 1024
    expect(res.storage.freeSpaceHeadroomPercent).toBe(20);
    expect(res.storage.raidType).toBe('raid5');
    expect(res.storage.raidOverheadPercent).toBe(20);

    // Usable storage with 20% headroom must be greater than net retention total
    expect(res.storage.usableStorageWithHeadroomTb).toBeGreaterThan(res.storage.netRetentionTotalTb);
    // Raw disk with RAID-5 (20%) must be greater than usable storage
    expect(res.storage.rawDiskRequiredTb).toBeGreaterThan(res.storage.usableStorageWithHeadroomTb);

    // Per-node NIC calculation
    expect(res.infrastructure.recommendedMediaNodes).toBe(1); // 100 channels fits on 1 node
    expect(res.ingress.perNodeNicSpeed).toBe('1 Gbps');
  });

  it('calculates H.265 bitrate saving compared to H.264', () => {
    const h264Res = MediaNodesService.calculateBenchmark({
      channelCount: 200,
      codec: 'h264',
      retentionDays: 14,
    });

    const h265Res = MediaNodesService.calculateBenchmark({
      channelCount: 200,
      codec: 'h265',
      retentionDays: 14,
    });

    // H.265 ingress and storage should be ~40% lower than H.264
    expect(h265Res.ingress.bitrateMbps).toBeLessThan(h264Res.ingress.bitrateMbps);
    expect(h265Res.storage.rawDiskRequiredTb).toBeLessThan(h264Res.storage.rawDiskRequiredTb);
  });

  it('generates time-limited HMAC TURN credentials with 24-hour expiration', () => {
    const ice = MediaNodesService.getWfhIceConfiguration();

    expect(ice.expiresInHours).toBe(24);
    expect(ice.turnServers.length).toBeGreaterThanOrEqual(2);

    const udpTurn = ice.turnServers[0];
    expect(udpTurn.username).toContain(':cctv_wfh_operator');
    // Username prefix is epoch timestamp
    const timestampStr = udpTurn.username.split(':')[0];
    const timestamp = parseInt(timestampStr, 10);
    expect(timestamp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // Credential is HMAC base64 string
    expect(udpTurn.credential.length).toBeGreaterThan(20);
  });
});
