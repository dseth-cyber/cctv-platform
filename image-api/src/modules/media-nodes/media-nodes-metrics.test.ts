import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaNodesService } from './media-nodes.service.js';

const mockPrisma = { mediaNode: { findMany: vi.fn(), upsert: vi.fn() } };
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));

const node = (over: Record<string, unknown>) => ({
  id: 'n1', name: 'mediamtx-primary', status: 'online', capacityChannels: 128, currentLoadChannels: 0, _count: { cameras: 10 },
  cpuPercent: 12.5, ramPercent: 24, diskPercent: 41.2, networkIngressMbps: 4.8, networkEgressMbps: 1.2, ...over,
});

describe('media node readings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows nothing for a node that has not reported for a while (the seeded 12.5% / 24% stayed on show)', async () => {
    mockPrisma.mediaNode.findMany.mockResolvedValue([node({ lastHeartbeatAt: new Date(Date.now() - 10 * 86400_000) })]);
    const [n] = await MediaNodesService.listMediaNodes();
    expect([n.cpuPercent, n.ramPercent, n.diskPercent, n.networkIngressMbps, n.networkEgressMbps]).toEqual([null, null, null, null, null]);
    expect(n.metricsCurrent).toBe(false);
  });

  it('shows nothing for a node that never reported', async () => {
    mockPrisma.mediaNode.findMany.mockResolvedValue([node({ lastHeartbeatAt: null })]);
    expect((await MediaNodesService.listMediaNodes())[0].cpuPercent).toBeNull();
  });

  it('shows the readings of a node that just reported', async () => {
    mockPrisma.mediaNode.findMany.mockResolvedValue([node({ lastHeartbeatAt: new Date(Date.now() - 5_000), cpuPercent: 33 })]);
    const [n] = await MediaNodesService.listMediaNodes();
    expect(n.cpuPercent).toBe(33);
    expect(n.metricsCurrent).toBe(true);
  });
});
