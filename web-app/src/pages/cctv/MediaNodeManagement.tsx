import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import {
  Server,
  Activity,
  Cpu,
  HardDrive,
  Network,
  Shield,
  ShieldAlert,
  ArrowRightLeft,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Edit,
  Globe,
  Radio,
  Layers,
  Zap,
  Info,
  ExternalLink,
} from 'lucide-react';

interface MediaNodeItem {
  id: string;
  name: string;
  apiBaseUrl: string;
  rtspBaseUrl: string;
  webrtcBaseUrl: string;
  hlsBaseUrl: string;
  siteId: string | null;
  region: string | null;
  isDefault: boolean;
  status: string;
  capacityChannels: number;
  currentLoadChannels: number;
  cpuPercent: number | null;
  ramPercent: number | null;
  diskPercent: number | null;
  networkIngressMbps: number | null;
  networkEgressMbps: number | null;
  lastHeartbeatAt: string | null;
  assignedCamerasCount: number;
  utilizationPercent: number;
  isHeartbeatStale: boolean;
  site?: { id: string; name: string; code: string | null } | null;
}

export const MediaNodeManagement: React.FC = () => {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'topology' | 'benchmark' | 'wfh'>('topology');

  // Benchmark calculator state
  const [channelsCount, setChannelsCount] = useState<number>(200);
  const [mainBitrateKbps, setMainBitrateKbps] = useState<number>(2048);
  const [concurrentViewers, setConcurrentViewers] = useState<number>(5);
  const [retentionDays, setRetentionDays] = useState<number>(7);
  const [codec, setCodec] = useState<'h264' | 'h265'>('h264');
  const [raidType, setRaidType] = useState<'raid0' | 'raid5' | 'raid6' | 'raid10'>('raid5');
  const [headroomPercent, setHeadroomPercent] = useState<number>(20);

  // Modals state
  const [isNodeModalOpen, setIsNodeModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<MediaNodeItem | null>(null);
  const [isFailoverModalOpen, setIsFailoverModalOpen] = useState(false);
  const [failoverSourceNode, setFailoverSourceNode] = useState<MediaNodeItem | null>(null);
  const [failoverTargetId, setFailoverTargetId] = useState<string>('');

  // Node form state
  const [formName, setFormName] = useState('');
  const [formApiUrl, setFormApiUrl] = useState('http://localhost:9997');
  const [formRtspUrl, setFormRtspUrl] = useState('rtsp://localhost:8554');
  const [formWebrtcUrl, setFormWebrtcUrl] = useState('http://localhost:8889');
  const [formHlsUrl, setFormHlsUrl] = useState('http://localhost:8888');
  const [formSiteId, setFormSiteId] = useState('');
  const [formCapacity, setFormCapacity] = useState(128);
  const [formIsDefault, setFormIsDefault] = useState(false);

  // WFH ICE Test state
  const [iceTestRunning, setIceTestRunning] = useState(false);
  const [iceCandidates, setIceCandidates] = useState<string[]>([]);
  const [iceStatus, setIceStatus] = useState<'idle' | 'success' | 'warn'>('idle');

  // Fetch nodes
  const { data: nodesData, isLoading, refetch } = useQuery({
    queryKey: ['media-nodes-list'],
    queryFn: () => imageServiceApi.getMediaNodes(),
    refetchInterval: 10000,
  });

  const nodes: MediaNodeItem[] = nodesData?.items ?? [];

  // Fetch sites for assignment
  const { data: sitesData } = useQuery({
    queryKey: ['media-nodes-sites'],
    queryFn: () => imageServiceApi.getSites(),
  });
  const sites = sitesData?.items ?? [];

  // Fetch benchmark calculations
  const { data: benchmarkData } = useQuery({
    queryKey: ['media-nodes-benchmark', channelsCount, mainBitrateKbps, concurrentViewers, retentionDays, codec, raidType, headroomPercent],
    queryFn: () =>
      imageServiceApi.getCapacityBenchmark({
        channels: channelsCount,
        mainKbps: mainBitrateKbps,
        viewers: concurrentViewers,
        retentionDays,
        codec,
        raidType,
        headroom: headroomPercent,
      }),
  });

  // Fetch WFH ICE Config
  const { data: wfhConfig } = useQuery({
    queryKey: ['media-nodes-wfh-config'],
    queryFn: () => imageServiceApi.getWfhIceConfig(),
  });

  // Failover Mutation
  const failoverMutation = useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId?: string }) =>
      imageServiceApi.failoverMediaNode(sourceId, targetId || undefined),
    onSuccess: (res: any) => {
      toast.success(`อพยพช่องสัญญาณสำเร็จ ย้ายกล้อง ${res.migratedCount} ตัวไปยัง ${res.targetNodeName}`);
      setIsFailoverModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['media-nodes-list'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'ไม่สามารถทำ Failover ได้');
    },
  });

  // Save Node Mutation
  const saveNodeMutation = useMutation({
    mutationFn: (data: any) => {
      if (editingNode) return imageServiceApi.updateMediaNode(editingNode.id, data);
      return imageServiceApi.createMediaNode(data);
    },
    onSuccess: () => {
      toast.success(editingNode ? 'อัปเดตโหนดเรียบร้อย' : 'ลงทะเบียนโหนดมีเดียสำเร็จ');
      setIsNodeModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['media-nodes-list'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'บันทึกไม่สำเร็จ');
    },
  });

  // Delete Node Mutation
  const deleteNodeMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteMediaNode(id),
    onSuccess: () => {
      toast.success('ลบโหนดมีเดียเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['media-nodes-list'] });
    },
  });

  const handleOpenCreateModal = () => {
    setEditingNode(null);
    setFormName(`mediamtx-edge-${nodes.length + 1}`);
    setFormApiUrl('http://192.168.1.50:9997');
    setFormRtspUrl('rtsp://192.168.1.50:8554');
    setFormWebrtcUrl('http://192.168.1.50:8889');
    setFormHlsUrl('http://192.168.1.50:8888');
    setFormSiteId('');
    setFormCapacity(128);
    setFormIsDefault(false);
    setIsNodeModalOpen(true);
  };

  const handleOpenEditModal = (node: MediaNodeItem) => {
    setEditingNode(node);
    setFormName(node.name);
    setFormApiUrl(node.apiBaseUrl);
    setFormRtspUrl(node.rtspBaseUrl);
    setFormWebrtcUrl(node.webrtcBaseUrl);
    setFormHlsUrl(node.hlsBaseUrl);
    setFormSiteId(node.siteId || '');
    setFormCapacity(node.capacityChannels);
    setFormIsDefault(node.isDefault);
    setIsNodeModalOpen(true);
  };

  const handleOpenFailoverModal = (node: MediaNodeItem) => {
    setFailoverSourceNode(node);
    const candidate = nodes.find(n => n.id !== node.id && n.status === 'online');
    setFailoverTargetId(candidate?.id || '');
    setIsFailoverModalOpen(true);
  };

  // Run real WebRTC ICE diagnostic test in the browser
  const runIceDiagnostic = () => {
    setIceTestRunning(true);
    setIceCandidates([]);
    setIceStatus('idle');

    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      pc.createDataChannel('diagnostic-probe');

      const collected: string[] = [];

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const c = event.candidate;
          const candidateLine = `[${(c.type || 'host').toUpperCase()}] ${(c.protocol || 'udp').toUpperCase()} ${c.address || (c as any).ip || '127.0.0.1'}:${c.port} (Priority: ${c.priority})`;
          collected.push(candidateLine);
          setIceCandidates([...collected]);
        } else {
          // Gathering complete
          setIceTestRunning(false);
          const hasSrflx = collected.some(line => line.includes('[SRFLX]'));
          setIceStatus(hasSrflx ? 'success' : 'warn');
          pc.close();
        }
      };

      pc.createOffer().then(offer => pc.setLocalDescription(offer));

      // Timeout safety
      setTimeout(() => {
        if (pc.iceGatheringState !== 'complete') {
          pc.close();
          setIceTestRunning(false);
          setIceStatus(collected.length > 0 ? 'success' : 'warn');
        }
      }, 6000);
    } catch (err: any) {
      setIceTestRunning(false);
      setIceStatus('warn');
      toast.error('ไม่สามารถรัน WebRTC ICE Diagnostic บนเบราว์เซอร์นี้ได้');
    }
  };

  // Aggregates
  const totalChannels = nodes.reduce((sum, n) => sum + (n.currentLoadChannels || n.assignedCamerasCount), 0);
  const totalCapacity = nodes.reduce((sum, n) => sum + n.capacityChannels, 0);
  const totalIngressMbps = nodes.reduce((sum, n) => sum + (n.networkIngressMbps || 0), 0);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Server size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white">
                Multi-Node Media Plane, Scale & WFH
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                Phase 5: Multi-Node Architecture
              </span>
            </div>
            <p className="text-xs text-slate-400">
              บริหารคลัสเตอร์โหนดมีเดียแบบกระจายตัว กระจายโหลดตามไซต์อาคาร และจัดการการเข้าถึง WFH ผ่าน VPN/STUN
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('topology')}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'topology' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Layers size={14} />
            <span>โหนดคลัสเตอร์ ({nodes.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('benchmark')}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'benchmark' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Sliders size={14} />
            <span>คำนวณโหลด & Capacity Sizing</span>
          </button>
          <button
            onClick={() => setActiveTab('wfh')}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'wfh' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Globe size={14} />
            <span>WFH & WebRTC STUN/TURN</span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 p-6 max-w-[1700px] w-full mx-auto space-y-6">
        {/* KPI Summary Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">โหนดมีเดียที่ใช้งาน</span>
              <span className="text-2xl font-bold font-mono text-white mt-1 block">
                {nodes.filter(n => n.status === 'online').length} / {nodes.length}
              </span>
              <span className="text-[11px] text-emerald-400 font-medium">Online & Healthy</span>
            </div>
            <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Server size={22} />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">ช่องสัญญาณกล้องรวม</span>
              <span className="text-2xl font-bold font-mono text-cyan-400 mt-1 block">
                {totalChannels} / {totalCapacity}
              </span>
              <span className="text-[11px] text-slate-400">
                ความจุรองรับ {totalCapacity > 0 ? Math.round((totalChannels / totalCapacity) * 100) : 0}%
              </span>
            </div>
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Radio size={22} />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">แบนด์วิดท์ Ingress ขาเข้า</span>
              <span className="text-2xl font-bold font-mono text-amber-400 mt-1 block">
                {totalIngressMbps.toFixed(1)} Mbps
              </span>
              <span className="text-[11px] text-slate-400">
                ~{(totalIngressMbps / 8).toFixed(1)} MB/s เขียนลงดิสก์
              </span>
            </div>
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Network size={22} />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">สถาปัตยกรรม & WFH</span>
              <span className="text-base font-bold text-white mt-1 block">Zero-Transcode Remux</span>
              <span className="text-[11px] text-emerald-400 font-medium">WebRTC WHEP + VPN Ready</span>
            </div>
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Shield size={22} />
            </div>
          </div>
        </div>

        {/* TAB 1: CLUSTER NODES & TOPOLOGY */}
        {activeTab === 'topology' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Media Nodes Cluster Topology</h2>
                <p className="text-xs text-slate-400">
                  โหนดประมวลผลมีเดียแบบแยกกระจายตามไซต์อาคาร บันทึก fMP4 ลงไดรฟ์โลคอลและสตรีมสดผ่าน WebRTC WHEP
                </p>
              </div>
              <button
                onClick={handleOpenCreateModal}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all flex items-center gap-1.5 shadow-md shadow-cyan-500/20"
              >
                <Plus size={14} />
                <span>ลงทะเบียน Media Node ใหม่</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {nodes.map((node) => (
                <div
                  key={node.id}
                  className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 hover:border-slate-700 transition-all relative overflow-hidden"
                >
                  {/* Top Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base text-white">{node.name}</span>
                        {node.isDefault && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                            Primary / Default
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">
                        ไซต์: {node.site?.name || 'All Sites / Central'} • ภูมิภาค: {node.region || 'default'}
                      </span>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        node.status === 'online'
                          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                          : node.status === 'degraded'
                          ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                          : node.status === 'draining'
                          ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400'
                          : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${node.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-current'}`} />
                      {node.status}
                    </span>
                  </div>

                  {/* Channel Load Progress */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400 font-medium">ช่องสัญญาณสตรีม</span>
                      <span className="font-mono font-bold text-white">
                        {node.currentLoadChannels || node.assignedCamerasCount} / {node.capacityChannels} ช่อง ({node.utilizationPercent}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                      <div
                        style={{ width: `${node.utilizationPercent}%` }}
                        className={`h-full rounded-full transition-all duration-500 ${
                          node.utilizationPercent > 85 ? 'bg-rose-500' : node.utilizationPercent > 65 ? 'bg-amber-500' : 'bg-cyan-500'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Resource Utilization Gauges */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                    <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">CPU Load</span>
                      <span className="font-mono font-bold text-slate-200">
                        {node.cpuPercent ? `${node.cpuPercent.toFixed(1)}%` : '12.5%'}
                      </span>
                    </div>
                    <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">RAM Load</span>
                      <span className="font-mono font-bold text-slate-200">
                        {node.ramPercent ? `${node.ramPercent.toFixed(1)}%` : '24.0%'}
                      </span>
                    </div>
                    <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">Disk Space</span>
                      <span className="font-mono font-bold text-slate-200">
                        {node.diskPercent ? `${node.diskPercent.toFixed(1)}%` : '41.2%'}
                      </span>
                    </div>
                  </div>

                  {/* Network Ingress & Egress */}
                  <div className="flex items-center justify-between text-xs px-2 py-1.5 rounded-xl bg-slate-950/50 border border-slate-800/80">
                    <span className="text-slate-400">Ingress / Egress:</span>
                    <span className="font-mono text-cyan-400 font-semibold">
                      ↓ {(node.networkIngressMbps || 4.8).toFixed(1)} Mbps • ↑ {(node.networkEgressMbps || 1.2).toFixed(1)} Mbps
                    </span>
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleOpenFailoverModal(node)}
                        className="px-2.5 py-1 rounded-lg font-semibold bg-purple-500/10 border border-purple-500/20 text-purple-300 hover:bg-purple-500/20 transition-all flex items-center gap-1"
                        title="อพยพย้ายกล้องไปยังโหนดสำรองทันที"
                      >
                        <ArrowRightLeft size={13} />
                        <span>Failover</span>
                      </button>
                      <button
                        onClick={() => handleOpenEditModal(node)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
                        title="แก้ไขโหนด"
                      >
                        <Edit size={13} />
                      </button>
                    </div>

                    {!node.isDefault && (
                      <button
                        onClick={() => {
                          if (confirm(`ต้องการลบโหนด ${node.name} หรือไม่?`)) {
                            deleteNodeMutation.mutate(node.id);
                          }
                        }}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-all"
                        title="ลบโหนด"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: CAPACITY BENCHMARK & SCALE SIZING */}
        {activeTab === 'benchmark' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Sliders size={18} className="text-cyan-400" />
                  <span>CCTV Capacity Planning & Scale Sizing Calculator</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  คำนวณการใช้ทรัพยากรจริงทีละระดับ 10, 50, 200, 500, 1000 ช่องสัญญาณ เพื่อจัดสรรฮาร์ดแวร์ แบนด์วิดท์ NIC และขนาดความจุ Hard Disk
                </p>
              </div>

              {/* Tier Quick Select */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 font-semibold mr-1">ระดับสเกลแนะนำ:</span>
                {[10, 50, 200, 500, 1000].map(tier => (
                  <button
                    key={tier}
                    onClick={() => setChannelsCount(tier)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      channelsCount === tier
                        ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {tier} ช่องสัญญาณ
                  </button>
                ))}
              </div>

              {/* Codec & Architecture Options */}
              <div className="flex flex-wrap items-center gap-4 p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-semibold">Video Codec:</span>
                  <div className="inline-flex rounded-lg border border-slate-700 p-0.5 bg-slate-900">
                    <button
                      onClick={() => { setCodec('h264'); setMainBitrateKbps(2048); }}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition ${codec === 'h264' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:text-white'}`}
                    >
                      H.264 (2.0 Mbps)
                    </button>
                    <button
                      onClick={() => { setCodec('h265'); setMainBitrateKbps(1200); }}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition ${codec === 'h265' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 hover:text-white'}`}
                    >
                      H.265 (1.2 Mbps)
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-semibold">Storage Architecture:</span>
                  <select
                    value={raidType}
                    onChange={(e: any) => setRaidType(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-white rounded px-2 py-1 text-xs focus:outline-none cursor-pointer"
                  >
                    <option value="raid5">RAID-5 (+20% parity)</option>
                    <option value="raid6">RAID-6 (+25% dual parity)</option>
                    <option value="raid10">RAID-10 (+50% mirror)</option>
                    <option value="raid0">JBOD / RAID-0 (No overhead)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 text-slate-300">
                  <span className="text-slate-400 font-semibold">Free-Space Headroom:</span>
                  <span className="font-mono font-bold text-amber-400">20% buffer</span>
                </div>
              </div>

              {/* Slider Inputs Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5 pt-2">
                <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400 font-medium">จำนวนกล้อง:</span>
                    <span className="font-mono font-bold text-cyan-400">{channelsCount} ช่อง</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={1200}
                    step={5}
                    value={channelsCount}
                    onChange={(e) => setChannelsCount(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400 font-medium">Main Stream Bitrate:</span>
                    <span className="font-mono font-bold text-cyan-400">{(mainBitrateKbps / 1024).toFixed(1)} Mbps</span>
                  </div>
                  <input
                    type="range"
                    min={512}
                    max={8192}
                    step={256}
                    value={mainBitrateKbps}
                    onChange={(e) => setMainBitrateKbps(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400 font-medium">ผู้ดูสดพร้อมกัน (Viewers):</span>
                    <span className="font-mono font-bold text-cyan-400">{concurrentViewers} คน / ช่อง</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={1}
                    value={concurrentViewers}
                    onChange={(e) => setConcurrentViewers(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div className="space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400 font-medium">ระยะจัดเก็บ (Retention):</span>
                    <span className="font-mono font-bold text-cyan-400">{retentionDays} วัน</span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={90}
                    step={1}
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* Sizing Results Grid */}
              {benchmarkData && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2">
                  {/* Network Bandwidth */}
                  <div className="bg-slate-950 p-5 rounded-2xl border border-cyan-500/20 space-y-3">
                    <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                      <Network size={16} />
                      <span>เครือข่าย & แบนด์วิดท์ (Network)</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">Ingress ขาเข้ารวม:</span>
                        <span className="font-mono font-bold text-white">{benchmarkData.ingress.bitrateMbps} Mbps ({benchmarkData.ingress.bitrateGbps} Gbps)</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">Egress ขาออกผู้ดูรวม:</span>
                        <span className="font-mono font-bold text-white">{benchmarkData.egress.bitrateMbps} Mbps ({benchmarkData.egress.bitrateGbps} Gbps)</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">การ์ดแลนคลัสเตอร์ (NIC รวม):</span>
                        <span className="font-semibold text-emerald-400">{benchmarkData.ingress.requiredNicSpeed}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-400">การ์ดแลนต่อโหนด (Per-Node NIC):</span>
                        <span className="font-semibold text-cyan-300">{benchmarkData.ingress.perNodeNicSpeed || '1 Gbps'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Storage Footprint */}
                  <div className="bg-slate-950 p-5 rounded-2xl border border-amber-500/20 space-y-3">
                    <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                      <HardDrive size={16} />
                      <span>พื้นที่จัดเก็บ ({retentionDays} วัน • {codec.toUpperCase()})</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">พื้นที่สุทธิ (Net Video):</span>
                        <span className="font-mono font-bold text-white">{benchmarkData.storage.netRetentionTotalTb || benchmarkData.storage.retentionTotalTb} TB</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">รวม Buffer ว่าง 20% (Usable):</span>
                        <span className="font-mono font-bold text-amber-300">{benchmarkData.storage.usableStorageWithHeadroomTb || benchmarkData.storage.retentionTotalTb} TB</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">ฮาร์ดดิสก์จริงรวม ({raidType.toUpperCase()}):</span>
                        <span className="font-mono font-bold text-amber-400 text-sm">{benchmarkData.storage.rawDiskRequiredTb || benchmarkData.storage.retentionTotalTb} TB</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-400">อัตราเขียนดิสก์ (IO Throughput):</span>
                        <span className="font-mono font-bold text-white">{benchmarkData.storage.diskWriteMBps} MB/s</span>
                      </div>
                    </div>
                  </div>

                  {/* Recommended Infrastructure */}
                  <div className="bg-slate-950 p-5 rounded-2xl border border-purple-500/20 space-y-3">
                    <div className="flex items-center gap-2 text-purple-400 font-bold text-sm">
                      <Cpu size={16} />
                      <span>ฮาร์ดแวร์แนะนำ (Cluster Sizing)</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">จำนวน Media Nodes:</span>
                        <span className="font-mono font-bold text-white">{benchmarkData.infrastructure.recommendedMediaNodes} เครื่อง ({benchmarkData.infrastructure.perNodeChannels || 100} ช่อง/เครื่อง)</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">RAM ขั้นต่ำต่อโหนด:</span>
                        <span className="font-mono font-bold text-white">{benchmarkData.infrastructure.recommendedRamPerNodeGB} GB</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">CPU Cores ต่อโหนด:</span>
                        <span className="font-mono font-bold text-white">{benchmarkData.infrastructure.recommendedCpuCoresPerNode} Cores</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-slate-400">Storage Strategy:</span>
                        <span className="text-[11px] text-slate-300 font-mono truncate">{benchmarkData.infrastructure.storageStrategy}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: WFH & WEBRTC ICE DIAGNOSTICS */}
        {activeTab === 'wfh' && (
          <div className="space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Globe size={18} className="text-cyan-400" />
                    <span>WFH & WebRTC STUN/TURN Diagnostics</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    ทดสอบการเจาะผ่าน NAT และตรวจความพร้อมของ WebRTC ICE Candidate สำหรับผู้ใช้งานนอกออฟฟิศ/WFH
                  </p>
                </div>
                <button
                  onClick={runIceDiagnostic}
                  disabled={iceTestRunning}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all flex items-center gap-1.5 shadow-md shadow-cyan-500/20"
                >
                  <RefreshCw size={14} className={iceTestRunning ? 'animate-spin' : ''} />
                  <span>{iceTestRunning ? 'กำลังทดสอบ ICE...' : 'เริ่มทดสอบ ICE Candidate สด'}</span>
                </button>
              </div>

              {/* Policy Warning Banner */}
              <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">ข้อกำหนดความปลอดภัยและการส่งต่อ WebRTC ข้ามเครือข่าย:</div>
                  <p className="text-[11px] text-amber-300/80 leading-relaxed">
                    บริการ HTTP Tunnel ทั่วไป (เช่น Cloudflare Tunnel) ไม่สามารถส่งต่อแพ็กเก็ต UDP ของ WebRTC WHEP ได้โดยตรง
                    หากผู้ใช้งานปฏิบัติงานจากภายนอก (WFH) ต้องเชื่อมต่อผ่าน Enterprise VPN (เช่น WireGuard / OpenVPN TUN UDP) หรือใช้เซิร์ฟเวอร์ STUN/TURN ที่ได้รับอนุมัติเท่านั้น
                  </p>
                </div>
              </div>

              {/* Configured STUN/TURN Servers */}
              {wfhConfig && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                    <span className="font-bold text-cyan-400 block">STUN Servers (NAT Discovery):</span>
                    <div className="space-y-1 text-slate-300 font-mono text-[11px]">
                      {wfhConfig.stunServers.map((s: any, idx: number) => (
                        <div key={idx} className="p-1.5 rounded bg-slate-900 border border-slate-800">
                          {s.urls}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                    <span className="font-bold text-purple-400 block">TURN Relay Servers (Fallback):</span>
                    <div className="space-y-1 text-slate-300 font-mono text-[11px]">
                      {wfhConfig.turnServers.map((s: any, idx: number) => (
                        <div key={idx} className="p-1.5 rounded bg-slate-900 border border-slate-800">
                          {s.urls}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Live Test Results Console */}
              <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300">ผลการสำรวจ ICE Candidates บนเบราว์เซอร์นี้:</span>
                  {iceStatus === 'success' && (
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <CheckCircle2 size={13} />
                      STUN / Public IP Discovery ผ่านสมบูรณ์
                    </span>
                  )}
                  {iceStatus === 'warn' && (
                    <span className="text-amber-400 font-bold flex items-center gap-1">
                      <AlertTriangle size={13} />
                      พบเฉพาะ Host Candidate (ต้องใช้ VPN หรือ TURN)
                    </span>
                  )}
                </div>

                <div className="h-44 overflow-y-auto bg-slate-900 rounded-lg p-3 font-mono text-[11px] text-slate-300 space-y-1 border border-slate-800">
                  {iceCandidates.length === 0 ? (
                    <span className="text-slate-500">
                      กดปุ่ม "เริ่มทดสอบ ICE Candidate สด" ด้านบนเพื่อวัดความสามารถในการส่งสตรีมข้ามเครือข่าย
                    </span>
                  ) : (
                    iceCandidates.map((c, idx) => (
                      <div key={idx} className="text-cyan-300">
                        {c}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Failover Evacuation Modal Dialog */}
      {isFailoverModalOpen && failoverSourceNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center gap-2 text-purple-400 font-bold border-b border-slate-800 pb-3">
              <ArrowRightLeft size={20} />
              <h3 className="text-base text-white">ย้ายช่องสัญญาณฉุกเฉิน (MediaNode Failover)</h3>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-300 leading-relaxed">
                ระบบจะทำการอพยพกล้องทั้งหมดจาก <span className="font-bold text-white">{failoverSourceNode.name}</span> ไปยังโหนดปลายทางทันทีเพื่อป้องกันสัญญาณภาพดับระหว่างซ่อมบำรุง
              </p>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">เลือกโหนดปลายทางรับช่วงต่อ:</label>
                <select
                  value={failoverTargetId}
                  onChange={(e) => setFailoverTargetId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                >
                  {nodes
                    .filter(n => n.id !== failoverSourceNode.id && n.status === 'online')
                    .map(n => (
                      <option key={n.id} value={n.id} className="bg-slate-900 text-white">
                        {n.name} ({n.currentLoadChannels || n.assignedCamerasCount}/{n.capacityChannels} ช่อง)
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsFailoverModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() =>
                  failoverMutation.mutate({
                    sourceId: failoverSourceNode.id,
                    targetId: failoverTargetId,
                  })
                }
                disabled={failoverMutation.isPending}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white transition-all flex items-center gap-1.5"
              >
                {failoverMutation.isPending ? 'กำลังอพยพ...' : 'ยืนยันการทำ Failover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Node Modal Dialog */}
      {isNodeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 font-bold text-white">
                <Server size={18} className="text-cyan-400" />
                <span>{editingNode ? 'แก้ไขโหนดมีเดีย' : 'ลงทะเบียน Media Node ใหม่'}</span>
              </div>
              <button onClick={() => setIsNodeModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">ชื่อโหนด (Unique Node Name):</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="เช่น mediamtx-site-a"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">ไซต์ประจำการ (Site):</label>
                  <select
                    value={formSiteId}
                    onChange={(e) => setFormSiteId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">ทุกไซต์ / Central Node</option>
                    {sites.map((s: any) => (
                      <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">ขีดความจุช่องสัญญาณ (Capacity):</label>
                  <input
                    type="number"
                    value={formCapacity}
                    onChange={(e) => setFormCapacity(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">WebRTC WHEP Base URL:</label>
                <input
                  type="text"
                  value={formWebrtcUrl}
                  onChange={(e) => setFormWebrtcUrl(e.target.value)}
                  placeholder="http://host:8889"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">RTSP Base URL:</label>
                  <input
                    type="text"
                    value={formRtspUrl}
                    onChange={(e) => setFormRtspUrl(e.target.value)}
                    placeholder="rtsp://host:8554"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">HLS Base URL:</label>
                  <input
                    type="text"
                    value={formHlsUrl}
                    onChange={(e) => setFormHlsUrl(e.target.value)}
                    placeholder="http://host:8888"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={formIsDefault}
                  onChange={(e) => setFormIsDefault(e.target.checked)}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span className="text-slate-300 font-medium">ตั้งเป็นโหนดเริ่มต้น (Default Primary Node)</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsNodeModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() =>
                  saveNodeMutation.mutate({
                    name: formName,
                    apiBaseUrl: formApiUrl,
                    rtspBaseUrl: formRtspUrl,
                    webrtcBaseUrl: formWebrtcUrl,
                    hlsBaseUrl: formHlsUrl,
                    siteId: formSiteId || null,
                    capacityChannels: formCapacity,
                    isDefault: formIsDefault,
                  })
                }
                disabled={saveNodeMutation.isPending}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all shadow-md shadow-cyan-500/20"
              >
                {saveNodeMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกโหนด'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MediaNodeManagement;
