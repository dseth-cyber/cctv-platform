import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config/index.js';

export interface CreateMediaNodeDto {
  name: string;
  apiBaseUrl: string;
  rtspBaseUrl: string;
  webrtcBaseUrl: string;
  hlsBaseUrl: string;
  siteId?: string | null;
  region?: string;
  isDefault?: boolean;
  capacityChannels?: number;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

export interface UpdateMediaNodeDto extends Partial<CreateMediaNodeDto> {
  status?: string;
}

export interface NodeHeartbeatMetrics {
  cpuPercent?: number;
  ramPercent?: number;
  diskPercent?: number;
  currentLoadChannels?: number;
  networkIngressMbps?: number;
  networkEgressMbps?: number;
}

export interface BenchmarkParams {
  channelCount: number;
  mainBitrateKbps?: number; // default 2048 (2 Mbps)
  subBitrateKbps?: number;  // default 512 (512 Kbps)
  concurrentViewers?: number; // default 5 viewers per active stream
  retentionDays?: number; // default 7 days
}

export class MediaNodesService {
  /**
   * List all media nodes with calculated active streams, capacity utilization, and health state.
   */
  static async listMediaNodes(query?: { siteId?: string; status?: string }) {
    const prisma = getPrisma();
    const where: any = {};
    if (query?.siteId) where.siteId = query.siteId;
    if (query?.status) where.status = query.status;

    let nodes = await prisma.mediaNode.findMany({
      where,
      include: {
        site: { select: { id: true, name: true, code: true } },
        _count: { select: { cameras: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    // Auto-seed primary local media node if database is empty in dev
    if (nodes.length === 0) {
      await this.ensureDefaultLocalNode();
      nodes = await prisma.mediaNode.findMany({
        where,
        include: {
          site: { select: { id: true, name: true, code: true } },
          _count: { select: { cameras: true } },
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
    }

    // Check heartbeat freshness (stale > 60s marked as offline if previously online)
    const now = Date.now();
    return nodes.map((node) => {
      const lastHb = node.lastHeartbeatAt ? new Date(node.lastHeartbeatAt).getTime() : 0;
      const isHeartbeatStale = lastHb > 0 && now - lastHb > 60000;
      const effectiveStatus = isHeartbeatStale && node.status === 'online' ? 'degraded' : node.status;
      const utilizationPercent = Math.min(
        100,
        Math.round(((node.currentLoadChannels || node._count.cameras) / Math.max(1, node.capacityChannels)) * 100),
      );

      return {
        ...node,
        status: effectiveStatus,
        assignedCamerasCount: node._count.cameras,
        utilizationPercent,
        isHeartbeatStale,
      };
    });
  }

  /**
   * Get media node by ID.
   */
  static async getMediaNodeById(id: string) {
    const prisma = getPrisma();
    const node = await prisma.mediaNode.findUnique({
      where: { id },
      include: {
        site: true,
        cameras: {
          select: { id: true, name: true, channelNumber: true, streamPath: true, status: true },
        },
      },
    });
    if (!node) throw new Error(`MediaNode with id ${id} not found`);
    return node;
  }

  /**
   * Create new media node.
   */
  static async createMediaNode(dto: CreateMediaNodeDto) {
    const prisma = getPrisma();

    if (dto.isDefault) {
      await prisma.mediaNode.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const node = await prisma.mediaNode.create({
      data: {
        name: dto.name,
        apiBaseUrl: dto.apiBaseUrl,
        rtspBaseUrl: dto.rtspBaseUrl,
        webrtcBaseUrl: dto.webrtcBaseUrl,
        hlsBaseUrl: dto.hlsBaseUrl,
        siteId: dto.siteId ?? null,
        region: dto.region ?? 'default',
        isDefault: dto.isDefault ?? false,
        capacityChannels: dto.capacityChannels ?? 100,
        iceServers: dto.iceServers ? JSON.stringify(dto.iceServers) : '[]',
        status: 'online',
        lastHeartbeatAt: new Date(),
      },
    });

    logger.info({ nodeId: node.id, name: node.name }, 'Created MediaNode');
    return node;
  }

  /**
   * Update existing media node.
   */
  static async updateMediaNode(id: string, dto: UpdateMediaNodeDto) {
    const prisma = getPrisma();

    if (dto.isDefault) {
      await prisma.mediaNode.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const data: any = { ...dto };
    if (dto.iceServers) {
      data.iceServers = JSON.stringify(dto.iceServers);
    }

    const updated = await prisma.mediaNode.update({
      where: { id },
      data,
    });

    logger.info({ nodeId: id }, 'Updated MediaNode');
    return updated;
  }

  /**
   * Delete media node (only if no cameras assigned, or set to null).
   */
  static async deleteMediaNode(id: string) {
    const prisma = getPrisma();

    // Detach cameras from this node first
    await prisma.camera.updateMany({
      where: { mediaNodeId: id },
      data: { mediaNodeId: null },
    });

    await prisma.mediaNode.delete({
      where: { id },
    });

    logger.info({ nodeId: id }, 'Deleted MediaNode');
    return { success: true, id };
  }

  /**
   * Heartbeat report from media node daemon.
   */
  static async reportHeartbeat(id: string, metrics: NodeHeartbeatMetrics) {
    const prisma = getPrisma();

    const updated = await prisma.mediaNode.update({
      where: { id },
      data: {
        lastHeartbeatAt: new Date(),
        cpuPercent: metrics.cpuPercent ?? 0,
        ramPercent: metrics.ramPercent ?? 0,
        diskPercent: metrics.diskPercent ?? 0,
        currentLoadChannels: metrics.currentLoadChannels ?? 0,
        networkIngressMbps: metrics.networkIngressMbps ?? 0,
        networkEgressMbps: metrics.networkEgressMbps ?? 0,
        status: (metrics.cpuPercent && metrics.cpuPercent > 92) || (metrics.diskPercent && metrics.diskPercent > 95)
          ? 'degraded'
          : 'online',
      },
    });

    return updated;
  }

  /**
   * Failover / evacuate cameras from a degraded or dead media node to a healthy target node.
   */
  static async failoverNode(sourceNodeId: string, explicitTargetNodeId?: string) {
    const prisma = getPrisma();

    let targetNodeId = explicitTargetNodeId;

    if (!targetNodeId) {
      // Find least loaded healthy node
      const candidates = await prisma.mediaNode.findMany({
        where: {
          id: { not: sourceNodeId },
          status: 'online',
        },
        orderBy: { currentLoadChannels: 'asc' },
      });

      if (candidates.length === 0) {
        throw new Error('No healthy candidate MediaNodes available for failover migration');
      }
      targetNodeId = candidates[0].id;
    }

    const targetNode = await prisma.mediaNode.findUnique({
      where: { id: targetNodeId },
    });

    if (!targetNode) {
      throw new Error(`Target MediaNode ${targetNodeId} not found`);
    }

    // Move cameras
    const result = await prisma.camera.updateMany({
      where: { mediaNodeId: sourceNodeId },
      data: { mediaNodeId: targetNodeId },
    });

    // Mark source node as draining / offline
    await prisma.mediaNode.update({
      where: { id: sourceNodeId },
      data: { status: 'draining', currentLoadChannels: 0 },
    });

    logger.warn(
      { sourceNodeId, targetNodeId, migratedCount: result.count },
      'Executed CCTV MediaNode Failover evacuation',
    );

    return {
      sourceNodeId,
      targetNodeId,
      migratedCount: result.count,
      targetNodeName: targetNode.name,
    };
  }

  /**
   * Tiered Load Test & Capacity Planning Benchmark Calculator (10, 50, 200, 500, 1000 channels).
   */
  static calculateBenchmark(params: BenchmarkParams) {
    const channels = Math.max(1, params.channelCount);
    const mainKbps = params.mainBitrateKbps ?? 2048; // 2 Mbps
    const subKbps = params.subBitrateKbps ?? 512;    // 512 Kbps
    const viewers = params.concurrentViewers ?? 5;   // viewers per active channel
    const retentionDays = params.retentionDays ?? 7;

    // Bitrate calculation
    const ingressMbps = (channels * mainKbps) / 1024;
    const ingressGbps = ingressMbps / 1000;

    // Viewers egress (assume 70% watch sub-stream, 30% watch main-stream)
    const avgViewerBitrateKbps = 0.3 * mainKbps + 0.7 * subKbps;
    const activeViewingChannels = Math.min(channels, 24); // typical active monitoring channels
    const egressMbps = (activeViewingChannels * viewers * avgViewerBitrateKbps) / 1024;
    const egressGbps = egressMbps / 1000;

    // Storage per day calculation
    // 1 Mbps = 10.8 GB per 24 hours (1 * 1000 * 1000 * 86400 / 8 / 10^9)
    const gbPerChannelPerDay = (mainKbps / 1024) * 10.8;
    const totalStorageGbPerDay = channels * gbPerChannelPerDay;
    const totalStorageTbPerDay = totalStorageGbPerDay / 1000;

    const retentionTotalTb = totalStorageTbPerDay * retentionDays;

    // Recommended hardware nodes
    // Each media node comfortably handles ~100-150 channels @ 2Mbps remux
    const recommendedNodes = Math.max(1, Math.ceil(channels / 120));

    // NIC requirement
    const requiredNicSpeed = ingressGbps > 1.5 ? '10 Gbps SFP+' : ingressGbps > 0.8 ? '2.5 Gbps / Dual 1Gbps LACP' : '1 Gbps';

    // Disk Write Throughput
    const diskWriteMBps = (ingressMbps / 8) * 1.05; // 5% container overhead

    return {
      channelCount: channels,
      tier: channels <= 10 ? 'Tier 1 (Small / Retail)' : channels <= 50 ? 'Tier 2 (Building / Branch)' : channels <= 200 ? 'Tier 3 (Factory / Plant)' : channels <= 500 ? 'Tier 4 (Multi-Site Enterprise)' : 'Tier 5 (Campus / Mega Site)',
      ingress: {
        bitrateMbps: Math.round(ingressMbps * 10) / 10,
        bitrateGbps: Math.round(ingressGbps * 100) / 100,
        requiredNicSpeed,
      },
      egress: {
        activeViewingChannels,
        concurrentViewers: viewers,
        bitrateMbps: Math.round(egressMbps * 10) / 10,
        bitrateGbps: Math.round(egressGbps * 100) / 100,
      },
      storage: {
        gbPerChannelPerDay: Math.round(gbPerChannelPerDay * 10) / 10,
        storageTbPerDay: Math.round(totalStorageTbPerDay * 100) / 100,
        retentionDays,
        retentionTotalTb: Math.round(retentionTotalTb * 10) / 10,
        diskWriteMBps: Math.round(diskWriteMBps * 10) / 10,
      },
      infrastructure: {
        recommendedMediaNodes: recommendedNodes,
        recommendedRamPerNodeGB: channels <= 50 ? 4 : channels <= 200 ? 8 : 16,
        recommendedCpuCoresPerNode: channels <= 50 ? 2 : channels <= 200 ? 4 : 8,
        storageStrategy: 'Direct fMP4 Remux on NVMe/SSD buffer + SeaweedFS/NAS archive',
      },
    };
  }

  /**
   * WFH & Remote Access ICE / STUN / TURN Configurations.
   */
  static getWfhIceConfiguration() {
    return {
      mode: 'WebRTC Direct / TURN Relay for WFH',
      notice: 'Cloudflare / HTTP Tunnels cannot proxy raw UDP WebRTC streams directly without TURN relay. Use approved enterprise VPN or configured STUN/TURN servers.',
      stunServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      turnServers: [
        {
          urls: 'turn:turn.cctv-local.lc.co.th:3478?transport=udp',
          username: 'cctv_wfh_operator',
          credential: 'change-in-prod-turn-secret',
        },
        {
          urls: 'turn:turn.cctv-local.lc.co.th:3478?transport=tcp',
          username: 'cctv_wfh_operator',
          credential: 'change-in-prod-turn-secret',
        },
      ],
      vpnRecommendations: [
        'WireGuard / Tailscale (Full UDP support, zero NAT traversal latency)',
        'OpenVPN (TUN mode with UDP transport for optimal WebRTC throughput)',
      ],
    };
  }

  /**
   * Helper to ensure default local media node exists.
   */
  private static async ensureDefaultLocalNode() {
    const prisma = getPrisma();
    await prisma.mediaNode.upsert({
      where: { name: 'mediamtx-primary' },
      update: {},
      create: {
        name: 'mediamtx-primary',
        apiBaseUrl: config.mediamtx.apiUrl,
        rtspBaseUrl: config.mediamtx.rtspUrl,
        webrtcBaseUrl: config.mediamtx.webrtcUrl,
        hlsBaseUrl: config.mediamtx.hlsUrl,
        isDefault: true,
        region: 'local-dev',
        status: 'online',
        capacityChannels: 128,
        currentLoadChannels: 2,
        cpuPercent: 12.5,
        ramPercent: 24.0,
        diskPercent: 41.2,
        networkIngressMbps: 4.8,
        networkEgressMbps: 1.2,
        lastHeartbeatAt: new Date(),
        iceServers: JSON.stringify([
          { urls: 'stun:stun.l.google.com:19302' },
        ]),
      },
    });
  }
}
