import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Button, Modal } from '@/components/ui';
import { WhepPlayer } from '@/components/cctv/WhepPlayer';
import {
  Activity,
  Radio,
  Camera,
  Server,
  Building2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HardDrive,
  Cpu,
  Wifi,
  WifiOff,
  RefreshCw,
  Play,
  ShieldAlert,
  ArrowUpRight,
  Clock,
  Eye,
  Layers,
  ChevronRight,
  Zap,
  Bell,
  ShieldCheck,
  Search,
  ExternalLink,
  SlidersHorizontal,
} from 'lucide-react';

export default function CctvDashboard() {
  const { themeConfig } = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedSiteFilter, setSelectedSiteFilter] = useState<string>('all');
  const [previewCamera, setPreviewCamera] = useState<{ id: string; name: string } | null>(null);
  const [probingCameraId, setProbingCameraId] = useState<string | null>(null);
  const [probeResultModal, setProbeResultModal] = useState<any | null>(null);

  // Queries
  const {
    data: summary,
    isLoading: isSummaryLoading,
    refetch: refetchSummary,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['cctv-dashboard-summary'],
    queryFn: () => imageServiceApi.getDashboardSummary(),
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const { data: devices = [] } = useQuery({
    queryKey: ['cctv-devices'],
    queryFn: () => imageServiceApi.getDevices(),
  });

  const { data: cameras = [] } = useQuery({
    queryKey: ['cctv-cameras-all'],
    queryFn: () => imageServiceApi.getCameras({ limit: 1000 }),
  });

  // Probe single camera on the fly
  const probeCameraMutation = useMutation({
    mutationFn: async (cam: any) => {
      setProbingCameraId(cam.id);
      if (cam.rtspUrl) {
        // Parse host/port or probe device
        const cleaned = cam.rtspUrl.replace(/^rtsp:\/\//i, '');
        const withoutAuth = cleaned.includes('@') ? cleaned.split('@')[1] : cleaned;
        const hostAndPath = withoutAuth.split('/')[0];
        const [host, portStr] = hostAndPath.split(':');
        return imageServiceApi.probeDevice({
          ipAddress: host,
          rtspPort: portStr ? parseInt(portStr, 10) : 554,
        });
      } else if (cam.ipAddress) {
        return imageServiceApi.probeDevice({
          ipAddress: cam.ipAddress,
          rtspPort: 554,
        });
      }
      throw new Error(t('ui.cctvDashboard.noIpOrRtspUrlConfigured'));
    },
    onSuccess: (res, cam) => {
      setProbingCameraId(null);
      setProbeResultModal({ camera: cam, ...res });
      queryClient.invalidateQueries({ queryKey: ['cctv-dashboard-summary'] });
    },
    onError: (err: any) => {
      setProbingCameraId(null);
      toast.error(err?.message || t('ui.cctvDashboard.failedToProbeCamera'));
    },
  });

  // Acknowledge incident mutation
  const acknowledgeIncidentMutation = useMutation({
    mutationFn: (incidentId: string) =>
      imageServiceApi.updateIncidentWorkflow(incidentId, { acknowledge: true }),
    onSuccess: () => {
      toast.success(t('ui.cctvDashboard.incidentAcknowledged'));
      queryClient.invalidateQueries({ queryKey: ['cctv-dashboard-summary'] });
    },
  });

  // Compute stats fallback
  const stats = useMemo(() => {
    if (summary) return summary;
    const totalCams = cameras.length;
    const onlineCams = cameras.filter((c: any) => c.operationalStatus === 'online').length;
    const stalledCams = cameras.filter((c: any) => c.operationalStatus === 'unknown').length;
    const offlineCams = cameras.filter((c: any) => c.operationalStatus === 'offline').length;
    return {
      devices: {
        total: devices.length,
        online: devices.filter((d: any) => d.status === 'active').length,
        offline: devices.filter((d: any) => d.status !== 'active').length,
        totalChannels: devices.reduce((acc: number, d: any) => acc + (d.totalChannels || 1), 0),
        byType: { dvr: 0, nvr: 0, ip_camera: 0 },
        byBrand: {},
      },
      cameras: {
        total: totalCams,
        online: onlineCams,
        stalled: stalledCams,
        offline: offlineCams,
        healthPercent: totalCams > 0 ? Math.round((onlineCams / totalCams) * 100) : 100,
      },
      bandwidth: {
        totalBitrateMbps: Number((onlineCams * 2.5).toFixed(1)),
        estimatedMainMbps: Number((onlineCams * 2.5).toFixed(1)),
        estimatedSubMbps: Number((onlineCams * 0.5).toFixed(1)),
        mainStreamsActive: onlineCams,
        subStreamsActive: onlineCams,
        estimatedMonthlyStorageGb: Math.round(onlineCams * 2.5 * 324),
      },
      protocols: {
        webrtcWhep: onlineCams,
        rtsp: totalCams,
        hls: Math.min(onlineCams, 16),
      },
      sites: [],
      recentIncidents: [],
    };
  }, [summary, devices, cameras]);

  const healthScore = stats.cameras.healthPercent ?? 100;
  const healthColor =
    healthScore >= 90 ? 'text-emerald-400' : healthScore >= 70 ? 'text-amber-400' : 'text-rose-400';
  const healthBg =
    healthScore >= 90
      ? 'bg-emerald-500/10 border-emerald-500/30'
      : healthScore >= 70
      ? 'bg-amber-500/10 border-amber-500/30'
      : 'bg-rose-500/10 border-rose-500/30';

  // Filtered sites
  const displaySites = useMemo(() => {
    if (!stats.sites) return [];
    if (selectedSiteFilter === 'all') return stats.sites;
    return stats.sites.filter((s: any) => s.id === selectedSiteFilter);
  }, [stats.sites, selectedSiteFilter]);

  // Critical / Problematic Cameras (Offline or Stalled)
  const problematicCameras = useMemo(() => {
    return cameras.filter(
      (c: any) => c.operationalStatus === 'offline' || c.operationalStatus === 'unknown'
    ).slice(0, 8);
  }, [cameras]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Top Header & Operations Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <Radio size={24} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">
                {t('ui.cctvDashboard.cctvMonitoringOperations')}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                {t('ui.cctvDashboard.live')}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {t('ui.cctvDashboard.highScaleDvrNvrSurveillanceMatrix')}
            </p>
          </div>
        </div>

        {/* Action Buttons & Quick Navigation */}
        <div className="flex items-center flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-xs gap-1.5 border border-white/10 ${
              autoRefresh ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-slate-400 hover:bg-white/5'
            }`}
          >
            <RefreshCw size={13} className={autoRefresh ? 'animate-spin' : ''} />
            <span>{autoRefresh ? t('ui.cctvDashboard.autoSync10s') : t('ui.cctvDashboard.paused')}</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetchSummary()}
            className="text-xs gap-1.5 text-slate-300 hover:bg-white/10 border border-white/10"
          >
            <RefreshCw size={13} />
            <span>{t('ui.cctvDashboard.refresh')}</span>
          </Button>

          <Button
            size="sm"
            onClick={() => navigate('/cctv/live-grid')}
            className="text-xs gap-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium shadow-md shadow-cyan-900/40"
          >
            <Play size={13} />
            <span>{t('ui.cctvDashboard.openLiveWall')}</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate('/cctv/map')}
            className="text-xs gap-1.5 text-slate-300 hover:bg-white/10 border border-white/10"
          >
            <MapPin size={13} />
            <span>{t('ui.cctvDashboard.floorPlanMap')}</span>
          </Button>
        </div>
      </div>

      {/* KPI Hero Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Total Channels */}
        <div className="bg-slate-900/60 backdrop-blur-md p-4 rounded-xl border border-white/10 shadow-lg relative overflow-hidden group hover:border-cyan-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
            <span>{t('ui.cctvDashboard.totalChannels')}</span>
            <Camera size={15} className="text-cyan-400" />
          </div>
          <div className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            {stats.cameras.total.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            <span className="text-cyan-400 font-semibold">{stats.devices.total}</span>{' '}{t('ui.cctvDashboard.dvrNVRs')}{stats.devices.totalChannels}{' '}{t('ui.cctvDashboard.ch')}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-500 to-blue-500 opacity-60" />
        </div>

        {/* Live Active Streams */}
        <div className="bg-slate-900/60 backdrop-blur-md p-4 rounded-xl border border-white/10 shadow-lg relative overflow-hidden group hover:border-emerald-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
            <span>{t('ui.cctvDashboard.streamsActive')}</span>
            <CheckCircle2 size={15} className="text-emerald-400" />
          </div>
          <div className="text-2xl md:text-3xl font-extrabold text-emerald-400 tracking-tight">
            {stats.cameras.online.toLocaleString()}
          </div>
          <div className="text-[11px] text-emerald-400/80 mt-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
            {t('ui.cctvDashboard.whepRtspFlowing')}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500 to-teal-500 opacity-60" />
        </div>

        {/* Video Stalled / Dropped */}
        <div className="bg-slate-900/60 backdrop-blur-md p-4 rounded-xl border border-white/10 shadow-lg relative overflow-hidden group hover:border-amber-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
            <span>{t('ui.cctvDashboard.videoStalled')}</span>
            <AlertTriangle size={15} className="text-amber-400" />
          </div>
          <div className="text-2xl md:text-3xl font-extrabold text-amber-400 tracking-tight">
            {stats.cameras.stalled.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {t('ui.cctvDashboard.socketOkZeroFrames')}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 to-orange-500 opacity-60" />
        </div>

        {/* Offline / Unreachable */}
        <div className="bg-slate-900/60 backdrop-blur-md p-4 rounded-xl border border-white/10 shadow-lg relative overflow-hidden group hover:border-rose-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
            <span>{t('ui.cctvDashboard.offlineDevices')}</span>
            <XCircle size={15} className="text-rose-400" />
          </div>
          <div className="text-2xl md:text-3xl font-extrabold text-rose-400 tracking-tight">
            {stats.cameras.offline.toLocaleString()}
          </div>
          <div className="text-[11px] text-rose-400/80 mt-1 flex items-center gap-1">
            <WifiOff size={11} />
            {t('ui.cctvDashboard.port55480Timeout')}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-rose-500 to-red-500 opacity-60" />
        </div>

        {/* Aggregate Bandwidth */}
        <div className="bg-slate-900/60 backdrop-blur-md p-4 rounded-xl border border-white/10 shadow-lg relative overflow-hidden group hover:border-blue-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
            <span>{t('ui.cctvDashboard.estBandwidth')}</span>
            <Activity size={15} className="text-blue-400" />
          </div>
          <div className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            {stats.bandwidth.totalBitrateMbps > 1000
              ? t('ui.cctvDashboard.gbps', { v0: (stats.bandwidth.totalBitrateMbps / 1000).toFixed(2) })
              : t('ui.cctvDashboard.mbps', { totalBitrateMbps: stats.bandwidth.totalBitrateMbps })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            <span>{t('ui.cctvDashboard.main')}{' '}{stats.bandwidth.estimatedMainMbps}M</span> • <span>{t('ui.cctvDashboard.sub')}{' '}{stats.bandwidth.estimatedSubMbps}M</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-indigo-500 opacity-60" />
        </div>

        {/* System Health Score */}
        <div className={`p-4 rounded-xl border shadow-lg relative overflow-hidden ${healthBg}`}>
          <div className="flex items-center justify-between text-xs mb-1.5 opacity-90">
            <span>{t('ui.cctvDashboard.healthScore')}</span>
            <ShieldCheck size={15} className={healthColor} />
          </div>
          <div className={`text-2xl md:text-3xl font-black tracking-tight ${healthColor}`}>
            {healthScore}%
          </div>
          <div className="text-[11px] opacity-80 mt-1 flex items-center gap-1">
            {healthScore >= 90 ? t('ui.cctvDashboard.allStreamsStable') : t('ui.cctvDashboard.degradedChannels')}
          </div>
          <div
            className={`absolute bottom-0 left-0 right-0 h-0.5 ${
              healthScore >= 90 ? 'bg-emerald-400' : healthScore >= 70 ? 'bg-amber-400' : 'bg-rose-400'
            }`}
          />
        </div>
      </div>

      {/* Main Grid: Sites Breakdown & Live Incident Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sites & Locations Hierarchy Matrix (2 Cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900/60 backdrop-blur-md p-5 rounded-2xl border border-white/10 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-cyan-400" />
                <h2 className="text-base font-bold text-white">{t('ui.cctvDashboard.physicalSitesZonesBreakdown')}</h2>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400">{t('ui.cctvDashboard.filterSite')}</span>
                <select
                  value={selectedSiteFilter}
                  onChange={(e) => setSelectedSiteFilter(e.target.value)}
                  className="bg-slate-800 border border-white/10 rounded-lg px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">{t('ui.cctvDashboard.allSites')}{stats.sites?.length || 0})</option>
                  {stats.sites?.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {displaySites.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                <Building2 size={36} className="mx-auto mb-2 text-slate-600" />
                <p>{t('ui.cctvDashboard.noPhysicalSitesRegisteredYet')}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate('/cctv/sites')}
                  className="mt-3 text-xs gap-1.5"
                >
                  <Building2 size={13} />
                  <span>{t('ui.cctvDashboard.configureSites')}</span>
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {displaySites.map((site: any) => {
                  const percent = site.totalCameras > 0
                    ? Math.round((site.onlineCameras / site.totalCameras) * 100)
                    : 100;
                  return (
                    <div
                      key={site.id}
                      onClick={() => navigate('/cctv/live-grid')}
                      className="p-3.5 rounded-xl bg-slate-800/40 border border-white/5 hover:border-cyan-500/30 transition-all cursor-pointer group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white text-sm group-hover:text-cyan-300 transition-colors">
                            {site.name}
                          </span>
                          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white/5 text-slate-400 border border-white/10">
                            {site.code}
                          </span>
                        </div>
                        <span
                          className={`text-xs font-bold ${
                            percent >= 90 ? 'text-emerald-400' : percent >= 70 ? 'text-amber-400' : 'text-rose-400'
                          }`}
                        >
                          {percent}{t('ui.cctvDashboard.healthy')}
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-1.5 bg-slate-700/60 rounded-full overflow-hidden flex mb-2">
                        <div
                          style={{ width: `${percent}%` }}
                          className="bg-emerald-500 h-full rounded-full transition-all"
                        />
                        <div
                          style={{ width: `${100 - percent}%` }}
                          className="bg-rose-500 h-full transition-all"
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1 text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            {site.onlineCameras}{' '}{t('ui.cctvDashboard.online')}
                          </span>
                          {site.offlineCameras > 0 && (
                            <span className="flex items-center gap-1 text-rose-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                              {site.offlineCameras}{' '}{t('ui.cctvDashboard.offline')}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {site.deviceCount}{' '}{t('ui.cctvDashboard.devices')}{site.totalCameras}{' '}{t('ui.cctvDashboard.ch2')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Critical Cameras Quick-Check Wall */}
          <div className="bg-slate-900/60 backdrop-blur-md p-5 rounded-2xl border border-white/10 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert size={18} className="text-amber-400" />
                <h2 className="text-base font-bold text-white">{t('ui.cctvDashboard.attentionRequiredOfflineChannels')}</h2>
              </div>
              <span className="text-xs text-slate-400">
                {problematicCameras.length}{' '}{t('ui.cctvDashboard.channelsNeedOperatorReview')}
              </span>
            </div>

            {problematicCameras.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-sm">
                <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-400" />
                <p className="text-emerald-300 font-medium">{t('ui.cctvDashboard.allCameraChannelsAreRespondingNormally')}</p>
                <p className="text-xs text-slate-500 mt-1">{t('ui.cctvDashboard.noSocketTimeoutOrZeroFrame')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {problematicCameras.map((cam: any) => (
                  <div
                    key={cam.id}
                    className="p-3 rounded-xl bg-slate-800/40 border border-white/10 hover:border-amber-500/40 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-white truncate max-w-[120px]" title={cam.name}>
                          {cam.name}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                            cam.operationalStatus === 'offline'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {cam.operationalStatus === 'offline' ? t('ui.cctvDashboard.offline') : t('ui.cctvDashboard.stalled')}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-slate-400 truncate">
                        {cam.ipAddress || cam.rtspUrl || t('ui.cctvDashboard.rtspUrlPending')}
                      </p>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => probeCameraMutation.mutate(cam)}
                        disabled={probingCameraId === cam.id}
                        className="text-[11px] h-7 px-2 flex-1 text-slate-300 hover:bg-white/10 border border-white/10"
                      >
                        <RefreshCw size={11} className={probingCameraId === cam.id ? 'animate-spin' : ''} />
                        <span>{t('ui.cctvDashboard.probe')}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPreviewCamera({ id: cam.id, name: cam.name })}
                        className="text-[11px] h-7 px-2 flex-1 text-cyan-400 hover:bg-cyan-500/10 border border-cyan-500/20"
                      >
                        <Eye size={11} />
                        <span>{t('ui.cctvDashboard.live2')}</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar: Real-Time Stream Health & Protocols (1 Col) */}
        <div className="space-y-6">
          {/* Media Plane & Protocols */}
          <div className="bg-slate-900/60 backdrop-blur-md p-5 rounded-2xl border border-white/10 shadow-xl space-y-4">
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <Zap size={18} className="text-cyan-400" />
              <h2 className="text-base font-bold text-white">{t('ui.cctvDashboard.mediaPlaneProtocols')}</h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-white/5">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
                    <Radio size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">{t('ui.cctvDashboard.webRTCWhep')}</div>
                    <div className="text-[10px] text-slate-400">{t('ui.cctvDashboard.n300msUltraLowLatency')}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-cyan-400">{stats.protocols?.webrtcWhep || 0}</div>
                  <div className="text-[10px] text-slate-500">{t('ui.cctvDashboard.activePaths')}</div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-white/5">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                    <Server size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">{t('ui.cctvDashboard.rtspPassThrough')}</div>
                    <div className="text-[10px] text-slate-400">{t('ui.cctvDashboard.dvrNvrNativeSource')}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-indigo-400">{stats.protocols?.rtsp || 0}</div>
                  <div className="text-[10px] text-slate-500">{t('ui.cctvDashboard.configured')}</div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-white/5">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-teal-500/20 text-teal-400">
                    <Layers size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">{t('ui.cctvDashboard.hlsFallback')}</div>
                    <div className="text-[10px] text-slate-400">{t('ui.cctvDashboard.highLatencyRedundancy')}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-teal-400">{stats.protocols?.hls || 0}</div>
                  <div className="text-[10px] text-slate-500">{t('ui.cctvDashboard.available')}</div>
                </div>
              </div>
            </div>

            {/* Storage Projection */}
            <div className="p-3.5 rounded-xl bg-slate-800/30 border border-white/5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="flex items-center gap-1.5">
                  <HardDrive size={13} className="text-blue-400" />
                  {t('ui.cctvDashboard.monthly247StorageEst')}
                </span>
                <span className="font-bold text-white">
                  {(stats.bandwidth.estimatedMonthlyStorageGb / 1024).toFixed(1)}{' '}{t('ui.cctvDashboard.tb')}
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                {t('ui.cctvDashboard.calculatedOn')}{' '}{stats.bandwidth.mainStreamsActive}{' '}{t('ui.cctvDashboard.n1080pActiveChannelsAt')}
              </p>
            </div>
          </div>

          {/* Recent Incident Feed */}
          <div className="bg-slate-900/60 backdrop-blur-md p-5 rounded-2xl border border-white/10 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Bell size={18} className="text-rose-400" />
                <h2 className="text-base font-bold text-white">{t('ui.cctvDashboard.recentCctvAlerts')}</h2>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate('/cctv/incidents')}
                className="text-[11px] h-7 text-cyan-400 hover:bg-cyan-500/10 p-1"
              >
                <span>{t('ui.cctvDashboard.viewAll')}</span>
                <ChevronRight size={13} />
              </Button>
            </div>

            {(!stats.recentIncidents || stats.recentIncidents.length === 0) ? (
              <div className="py-6 text-center text-slate-400 text-xs">
                <CheckCircle2 size={24} className="mx-auto mb-1.5 text-emerald-400" />
                <p>{t('ui.cctvDashboard.noActiveIncidentsOpen')}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {stats.recentIncidents.map((inc: any) => (
                  <div
                    key={inc.id}
                    className="p-2.5 rounded-xl bg-slate-800/40 border border-white/5 space-y-1.5 hover:border-white/15 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">
                        {inc.camera?.name || t('ui.cctvDashboard.cameraEvent')}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 text-[10px] font-semibold rounded ${
                          inc.priority === 'critical'
                            ? 'bg-rose-500/20 text-rose-300'
                            : inc.priority === 'high'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-blue-500/20 text-blue-300'
                        }`}
                      >
                        {inc.priority}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-1">
                      {inc.problemDesc || inc.reason || t('ui.cctvDashboard.cameraOfflineStalled')}
                    </p>
                    <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px] text-slate-500">
                      <span>{new Date(inc.openedAt).toLocaleTimeString()}</span>
                      <button
                        onClick={() => acknowledgeIncidentMutation.mutate(inc.id)}
                        className="text-cyan-400 hover:underline"
                      >
                        {t('ui.cctvDashboard.acknowledge')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Preview Modal */}
      {previewCamera && (
        <Modal
          isOpen={Boolean(previewCamera)}
          onClose={() => setPreviewCamera(null)}
          title={t('ui.cctvDashboard.liveStreamInspection', { name: previewCamera.name })}
          size="xl"
        >
          <div className="space-y-4">
            <div className="aspect-video w-full rounded-xl overflow-hidden bg-black border border-white/10 shadow-2xl">
              <WhepPlayer
                streamUrl={`/mediamtx/webrtc/${(previewCamera as any).streamPath || previewCamera.id}/whep`}
                cameraName={previewCamera.name}
                streamProfile="main"
                autoPlay={true}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{t('ui.cctvDashboard.whepWebRTCConnectionActive')}</span>
              <Button size="sm" variant="ghost" onClick={() => setPreviewCamera(null)}>
                {t('ui.cctvDashboard.closePreview')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Probe Result Modal */}
      {probeResultModal && (
        <Modal
          isOpen={Boolean(probeResultModal)}
          onClose={() => setProbeResultModal(null)}
          title={t('ui.cctvDashboard.connectionProbe', { name: probeResultModal.camera?.name })}
          size="md"
        >
          <div className="space-y-4 p-2">
            <div
              className={`p-4 rounded-xl border flex items-center gap-3 ${
                probeResultModal.reachable
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}
            >
              {probeResultModal.reachable ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
              <div>
                <div className="font-bold text-sm">
                  {probeResultModal.reachable ? t('ui.cctvDashboard.targetResponding') : t('ui.cctvDashboard.targetUnreachable')}
                </div>
                <div className="text-xs opacity-90">{probeResultModal.message}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-800 border border-white/10">
                <span className="text-slate-400 block mb-1">{t('ui.cctvDashboard.rtspPort')}</span>
                <span className={probeResultModal.rtspOpen ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                  {probeResultModal.rtspOpen ? t('ui.cctvDashboard.openListening') : 'CLOSED'}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-800 border border-white/10">
                <span className="text-slate-400 block mb-1">{t('ui.cctvDashboard.roundTripLatency')}</span>
                <span className="text-white font-mono font-bold">
                  {probeResultModal.latencyMs ? `${probeResultModal.latencyMs} ms` : 'N/A'}
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={() => setProbeResultModal(null)}>
                {t('ui.cctvDashboard.dismiss')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
