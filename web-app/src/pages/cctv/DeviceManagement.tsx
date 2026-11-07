import { cleanShortCode } from '@/lib/clipName';
import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Button, Modal, TableSkeleton } from '@/components/ui';
import {
  HardDrive,
  Plus,
  RefreshCw,
  Search,
  Server,
  Camera,
  Layers,
  Edit,
  Trash2,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Shield,
  Activity,
  Radio,
  UploadCloud,
  Download,
  FileText,
  Check,
  X,
  Wifi,
  WifiOff,
  Loader2,
  Copy,
  ChevronLeft,
} from 'lucide-react';
import { ChannelChecklist } from '@/components/cctv/ChannelChecklist';
import { DeviceChannelsPanel } from '@/components/cctv/DeviceChannelsPanel';
import { LocationFields, useSitesWithZones } from '@/components/cctv/LocationFields';
import { useMasterdataOptions } from '@/hooks/useMasterdataOptions';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { downloadCsv, parseChannelList, parseCsv as readCsv, toCsv } from '@/lib/csv';
import { cloneIpPlaceholder, isValidIPv4, uniqueCopyName } from '@/lib/deviceChannels';

import { useTranslation } from 'react-i18next';
export default function DeviceManagement() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState('');
  // Arriving from a place, e.g. /cctv/devices?site=…&zone=…
  const [urlParams, setUrlParams] = useSearchParams();
  const siteParam = urlParams.get('site');
  const zoneParam = urlParams.get('zone');
  const deviceParam = urlParams.get('device');
  const cameBack = urlParams.get('back') === '1';
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<string>(() => urlParams.get('type') ?? 'all');
  const brandParam = urlParams.get('brand');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);
  const [previewCamera, setPreviewCamera] = useState<{ id: string; name: string } | null>(null);

  // Bulk Import State
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkInputText, setBulkInputText] = useState('');
  const [bulkParsedData, setBulkParsedData] = useState<any[]>([]);
  const [bulkParseErrors, setBulkParseErrors] = useState<string[]>([]);
  const [bulkImportResult, setBulkImportResult] = useState<any | null>(null);

  // Probe Test Connection State
  const [probeState, setProbeState] = useState<{
    loading: boolean;
    result: any | null;
    error: string | null;
  }>({ loading: false, result: null, error: null });

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    deviceType: 'dvr',
    brand: 'Hikvision',
    model: '',
    serialNumber: '',
    shortCode: '',
    ipAddress: '',
    rtspPort: 554,
    httpPort: 80,
    onvifPort: 8000,
    username: 'admin',
    password: '',
    totalChannels: 16,
    autoCreateCameras: true,
    siteId: '',
    zoneId: '',
  });
  // Channels with a camera in use, for a new device. Null: all of them, following the channel count.
  const [enabledChannels, setEnabledChannels] = useState<number[] | null>(null);
  const [cloneSource, setCloneSource] = useState<string | null>(null);
  const { user } = useAuth();
  const canEditChannels = hasPermission(user, 'cameras:update');
  const { options: brandOptions } = useMasterdataOptions('device_brand');
  const { options: deviceTypeOptions } = useMasterdataOptions('device_type');
  const { options: channelCountOptions } = useMasterdataOptions('device_channel_count');
  const { data: sites = [] } = useSitesWithZones();
  const sitesForChip = sites;

  // Queries
  const { data: allDevices = [], isLoading, refetch } = useQuery({
    queryKey: ['cctv-devices', selectedType],
    queryFn: () => imageServiceApi.getDevices(selectedType !== 'all' ? { deviceType: selectedType } : undefined),
  });

  const devices = (allDevices as any[]).filter((d) => (!brandParam || (brandParam === 'none' ? !d.brand : d.brand?.toLowerCase() === brandParam.toLowerCase())) && (!siteParam || d.siteId === siteParam) && (!zoneParam || d.zoneId === zoneParam) && (!deviceParam || d.id === deviceParam));
  const placeChip = (() => {
    if (deviceParam) return (allDevices as any[]).find((d) => d.id === deviceParam)?.name ?? '—';
    if (brandParam) return `${t('ui.deviceManagement.vendorBrand')}: ${brandParam === 'none' ? t('ui.cctvDashboard.notSpecified') : brandParam}`;
    if (!siteParam && !zoneParam) return null;
    const site = (sitesForChip as any[]).find((x) => x.id === siteParam);
    const zone = (sitesForChip as any[]).flatMap((x) => x.zones ?? []).find((z: any) => z.id === zoneParam);
    return [site?.name, zone?.name].filter(Boolean).join(' / ') || '—';
  })();

  const { data: templates = [] } = useQuery({
    queryKey: ['cctv-device-templates'],
    queryFn: () => imageServiceApi.getDeviceTemplates(),
  });

  const deviceErrorText = (err: any, fallback: string) => {
    const details = err?.response?.data?.details;
    if (details?.code === 'DEVICE_NAME_TAKEN') return t('ui.deviceManagement.nameTaken');
    if (details?.code === 'DEVICE_ADDRESS_TAKEN') return t('ui.deviceManagement.addressTaken', { device: details.device });
    return err?.response?.data?.message || fallback;
  };

  useEffect(() => {
    if (deviceParam) setExpandedDeviceId(deviceParam);
  }, [deviceParam]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => imageServiceApi.createDevice(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      toast.success(t('ui.deviceManagement.deviceAddedSuccessfully'));
      setIsModalOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      toast.error(deviceErrorText(err, t('ui.deviceManagement.failedToCreateDevice')));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateDevice(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      toast.success(t('ui.deviceManagement.deviceUpdated'));
      setIsModalOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      toast.error(deviceErrorText(err, t('ui.deviceManagement.failedToUpdateDevice')));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteDevice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      toast.success(t('ui.deviceManagement.deviceRemoved'));
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.deviceManagement.failedToDeleteDevice'));
    },
  });

  const provisionMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.provisionDeviceChannels(id),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      toast.success(t('ui.deviceManagement.provisionedCameraChannels', { provisionedCount: res.provisionedCount }));
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.deviceManagement.failedToProvisionChannels'));
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: (data: any[]) => imageServiceApi.bulkImportDevices(data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setBulkImportResult(res);
      toast.success(t('ui.deviceManagement.bulkImportCompletedDevicesCreatedChannels', { createdCount: res.importedCount, provisionedCamerasCount: res.totalCamerasCreated }));
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.deviceManagement.bulkImportFailed'));
    },
  });

  const handleProbeDevice = async () => {
    if (!formData.ipAddress) {
      toast.error(t('ui.deviceManagement.pleaseEnterAnIpAddressTo'));
      return;
    }
    setProbeState({ loading: true, result: null, error: null });
    try {
      const res = await imageServiceApi.probeDevice({
        ipAddress: formData.ipAddress,
        rtspPort: formData.rtspPort,
        httpPort: formData.httpPort,
      });
      setProbeState({ loading: false, result: res, error: null });
    } catch (err: any) {
      setProbeState({
        loading: false,
        result: null,
        error: err?.response?.data?.message || err?.message || 'Connection test failed',
      });
    }
  };

  const handleTemplateSelect = (vendorName: string) => {
    const tpl = templates.find(
      (t: any) =>
        t.brand?.toLowerCase() === vendorName.toLowerCase() ||
        t.vendor?.toLowerCase() === vendorName.toLowerCase()
    );
    if (tpl) {
      setFormData((prev) => ({
        ...prev,
        brand: tpl.brand || vendorName,
        deviceType: tpl.deviceType || prev.deviceType,
        rtspPort: tpl.defaultRtspPort || prev.rtspPort,
        httpPort: tpl.defaultHttpPort || prev.httpPort,
        onvifPort: tpl.defaultOnvifPort || prev.onvifPort,
        username: tpl.defaultUsername || prev.username,
      }));
    } else {
      setFormData((prev) => ({ ...prev, brand: vendorName }));
    }
  };

  const parseCsv = (csvText: string) => {
    const rows = readCsv(csvText);
    if (rows.length === 0) {
      setBulkParseErrors(['CSV must contain a header row and at least 1 record']);
      setBulkParsedData([]);
      return;
    }
    const missing = ['name', 'ipaddress'].filter((r) => !(r in rows[0]));
    if (missing.length > 0) {
      setBulkParseErrors([`Missing required headers: ${missing.join(', ')}`]);
      setBulkParsedData([]);
      return;
    }

    const items: any[] = [];
    const errors: string[] = [];
    rows.forEach((row, i) => {
      if (!row.name || !row.ipaddress) {
        errors.push(`Row ${i + 2}: Name and IP address are required`);
        return;
      }
      if (!isValidIPv4(row.ipaddress)) {
        errors.push(`Row ${i + 2}: "${row.ipaddress}" is not an IPv4 address`);
        return;
      }
      // By name or code, as typed on the sites page. An unknown place is reported, never dropped silently.
      const same = (a?: string | null, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
      const site = row.site ? sites.find((x: any) => same(x.name, row.site) || same(x.code, row.site)) : null;
      if (row.site && !site) {
        errors.push(`Row ${i + 2}: site "${row.site}" does not exist`);
        return;
      }
      const zone = row.zone ? site?.zones?.find((z: any) => same(z.name, row.zone) || same(z.code, row.zone)) : null;
      if (row.zone && !zone) {
        errors.push(`Row ${i + 2}: zone "${row.zone}" does not exist${site ? ` in "${site.name}"` : ' (fill in its site too)'}`);
        return;
      }
      const channels = parseChannelList(row.enabledchannels);
      if (row.enabledchannels && !channels) {
        errors.push(`Row ${i + 2}: enabledChannels must look like 1;2;5`);
        return;
      }
      items.push({
        name: row.name,
        ipAddress: row.ipaddress,
        brand: row.brand || 'Generic',
        deviceType: row.devicetype || 'dvr',
        model: row.model || '',
        serialNumber: row.serialnumber || '',
        description: row.description || undefined,
        totalChannels: parseInt(row.totalchannels, 10) || 16,
        username: row.username || 'admin',
        password: row.password || '',
        rtspPort: parseInt(row.rtspport, 10) || 554,
        httpPort: parseInt(row.httpport, 10) || 80,
        onvifPort: parseInt(row.onvifport, 10) || 8000,
        autoCreateCameras: row.autocreatecameras ? row.autocreatecameras.toLowerCase() === 'true' : true,
        ...(channels ? { enabledChannels: channels } : {}),
        ...(site ? { siteId: site.id } : {}),
        ...(zone ? { zoneId: zone.id } : {}),
      });
    });

    setBulkParseErrors(errors);
    setBulkParsedData(items);
  };

  const CSV_HEADERS = ['name', 'ipAddress', 'brand', 'deviceType', 'model', 'serialNumber', 'totalChannels', 'enabledChannels', 'username', 'password', 'rtspPort', 'httpPort', 'onvifPort', 'autoCreateCameras', 'description', 'site', 'zone'];

  // The same columns the import reads. Passwords are never included; they are typed into the file before importing it elsewhere.
  const handleExportCsv = () => {
    downloadCsv('devices.csv', toCsv(CSV_HEADERS, devices.map((d: any) => ({
      ...d,
      enabledChannels: (d.enabledChannels ?? []).join(';'),
      password: '',
      autoCreateCameras: 'true',
      site: d.site?.name ?? '',
      zone: d.zone?.name ?? '',
    }))));
  };

  const handleDownloadTemplate = () => downloadCsv('devices-template.csv', sampleCsv);

  const sampleCsv = `name,ipAddress,brand,deviceType,model,serialNumber,totalChannels,enabledChannels,username,password,rtspPort,httpPort,onvifPort,autoCreateCameras,description,site,zone
DVR Main Gate,192.168.1.101,Hikvision,dvr,DS-7208HQHI-K1,,8,1;2;3;5,admin,YourPassword,554,80,8000,true,Front gate and parking
NVR Warehouse,192.168.1.102,Dahua,nvr,,,32,,admin,YourPassword,554,80,,true,
IP Camera Office,192.168.1.104,Generic,ip_camera,,,1,,admin,YourPassword,554,80,,true,`;

  const resetForm = () => {
    setEnabledChannels(null);
    setCloneSource(null);
    setEditingDevice(null);
    setProbeState({ loading: false, result: null, error: null });
    setFormData({
      name: '',
      description: '',
      deviceType: 'dvr',
      brand: 'Hikvision',
      model: '',
      serialNumber: '',
      shortCode: '',
      ipAddress: '',
      rtspPort: 554,
      httpPort: 80,
      onvifPort: 8000,
      username: 'admin',
      password: '',
      totalChannels: 16,
      autoCreateCameras: true,
      siteId: '',
      zoneId: '',
    });
  };

  const openAddModal = () => {
    resetForm();
    if (siteParam) setFormData((prev) => ({ ...prev, siteId: siteParam, zoneId: zoneParam ?? '' }));
    setIsModalOpen(true);
  };

  // Everything but what makes a machine itself: its address and its password are for the person to fill in.
  const openCloneModal = (dev: any) => {
    setEditingDevice(null);
    setCloneSource(dev.name);
    setProbeState({ loading: false, result: null, error: null });
    setFormData({
      name: uniqueCopyName(dev.name, (allDevices as any[]).map((d: any) => d.name)),
      description: dev.description || '',
      deviceType: dev.deviceType || 'dvr',
      brand: dev.brand || 'Generic',
      model: dev.model || '',
      serialNumber: '',
      shortCode: '',
      ipAddress: cloneIpPlaceholder(dev.ipAddress),
      rtspPort: dev.rtspPort || 554,
      httpPort: dev.httpPort || 80,
      onvifPort: dev.onvifPort || 8000,
      username: dev.username || 'admin',
      password: '',
      totalChannels: dev.totalChannels || 16,
      autoCreateCameras: true,
      siteId: dev.siteId || '',
      zoneId: dev.zoneId || '',
    });
    setEnabledChannels(dev.enabledChannels ?? null);
    setIsModalOpen(true);
  };

  const openEditModal = (dev: any) => {
    setEnabledChannels(null);
    setCloneSource(null);
    setEditingDevice(dev);
    setProbeState({ loading: false, result: null, error: null });
    setFormData({
      name: dev.name,
      description: dev.description || '',
      deviceType: dev.deviceType || 'dvr',
      brand: dev.brand || 'Generic',
      model: dev.model || '',
      serialNumber: dev.serialNumber || '',
      shortCode: dev.shortCode || '',
      ipAddress: dev.ipAddress || '',
      rtspPort: dev.rtspPort || 554,
      httpPort: dev.httpPort || 80,
      onvifPort: dev.onvifPort || 8000,
      username: dev.username || 'admin',
      password: '',
      totalChannels: dev.totalChannels || 16,
      autoCreateCameras: false,
      siteId: dev.siteId || '',
      zoneId: dev.zoneId || '',
    });
    setIsModalOpen(true);
  };

  const ipValid = isValidIPv4(formData.ipAddress);
  const passwordMissing = !!cloneSource && !formData.password;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipValid || passwordMissing) return;
    if (editingDevice) {
      const payload: any = { ...formData, ipAddress: formData.ipAddress.trim(), siteId: formData.siteId || null, zoneId: formData.zoneId || null };
      if (!payload.password) delete payload.password;
      delete payload.autoCreateCameras;
      updateMutation.mutate({ id: editingDevice.id, data: payload });
    } else {
      createMutation.mutate({ ...formData, ipAddress: formData.ipAddress.trim(), siteId: formData.siteId || null, zoneId: formData.zoneId || null, ...(formData.autoCreateCameras && enabledChannels ? { enabledChannels } : {}) } as any);
    }
  };

  // Filtered devices
  const filteredDevices = devices.filter((d: any) => {
    const term = searchTerm.toLowerCase();
    const matchSearch =
      d.name.toLowerCase().includes(term) ||
      d.ipAddress?.toLowerCase().includes(term) ||
      d.brand?.toLowerCase().includes(term) ||
      d.serialNumber?.toLowerCase().includes(term) ||
      d.site?.name?.toLowerCase().includes(term) ||
      d.zone?.name?.toLowerCase().includes(term);
    return matchSearch;
  });

  // Aggregate stats
  const totalChannelsCount = devices.reduce((sum: number, d: any) => sum + (d.totalChannels || 0), 0);
  const totalProvisionedCount = devices.reduce((sum: number, d: any) => sum + (d.enabledChannels?.length ?? 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase bg-cyan-950 text-cyan-400 border border-cyan-800">
              {t('ui.deviceManagement.cctvPlatform')}
            </span>
            <span className="text-xs text-slate-400">{t('ui.deviceManagement.phase1Foundation')}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 mt-1 flex items-center gap-2">
            <HardDrive className="w-6 h-6 text-cyan-400" />
            {t('ui.deviceManagement.deviceManagementDvrNvrIpCam')}
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {t('ui.deviceManagement.manageRecordingUnitsConfigureVendorRtsp')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setIsBulkModalOpen(true);
              setBulkImportResult(null);
            }}
            className="flex items-center gap-1.5 border border-slate-700 hover:border-cyan-500"
          >
            <UploadCloud className="w-4 h-4 text-cyan-400" />
            {t('ui.deviceManagement.bulkImportCsv')}
          </Button>
          <Button
            variant="secondary"
            onClick={handleExportCsv}
            disabled={devices.length === 0}
            title={t('ui.deviceManagement.exportCsvHint')}
            className="flex items-center gap-1.5 border border-slate-700 hover:border-cyan-500"
          >
            <Download className="w-4 h-4 text-cyan-400" />
            {t('ui.deviceManagement.exportCsv')}
          </Button>
          <Button variant="secondary" onClick={() => refetch()} className="flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" />
            {t('ui.deviceManagement.refresh')}
          </Button>
          <Button onClick={openAddModal} className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white">
            <Plus className="w-4 h-4" />
            {t('ui.deviceManagement.addDevice')}
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">{t('ui.deviceManagement.totalDevices')}</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">{devices.length}</p>
          </div>
          <div className="p-3 bg-cyan-950/70 border border-cyan-800/50 rounded-lg text-cyan-400">
            <Server className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">{t('ui.deviceManagement.totalChannelCapacity')}</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">{totalChannelsCount}{' '}{t('ui.deviceManagement.ch')}</p>
          </div>
          <div className="p-3 bg-indigo-950/70 border border-indigo-800/50 rounded-lg text-indigo-400">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">{t('ui.deviceManagement.activeCameras')}</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{totalProvisionedCount}{' '}{t('ui.deviceManagement.cams')}</p>
          </div>
          <div className="p-3 bg-emerald-950/70 border border-emerald-800/50 rounded-lg text-emerald-400">
            <Camera className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">{t('ui.deviceManagement.mediaMTXGateway')}</p>
            <p className="text-sm font-semibold text-cyan-400 mt-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {t('ui.deviceManagement.onDemandWhep')}
            </p>
          </div>
          <div className="p-3 bg-amber-950/70 border border-amber-800/50 rounded-lg text-amber-400">
            <Radio className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
        {cameBack && (
          <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-700 text-slate-200 hover:border-cyan-500 whitespace-nowrap">
            <ChevronLeft className="w-3 h-3" />
            {t('ui.location.goBack')}
          </button>
        )}
        {placeChip && (
          <button
            type="button"
            onClick={() => setUrlParams({})}
            title={t('ui.location.clearFilter')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/25 whitespace-nowrap"
          >
            <span>{placeChip}</span>
            <X className="w-3 h-3" />
          </button>
        )}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder={t('ui.deviceManagement.searchByNameIpBrandS')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400 font-medium">{t('ui.deviceManagement.type')}</span>
          {['all', ...deviceTypeOptions.map((o) => o.value)].map((type) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-3 py-1 text-xs font-medium rounded-lg border transition capitalize ${
                selectedType === type
                  ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {type === 'all' ? t('ui.deviceManagement.allTypes') : type.replace(/_/g, ' ').toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Device List Table */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={4} cols={6} />
        ) : filteredDevices.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Server className="w-12 h-12 mx-auto text-slate-600 mb-3" />
            <p className="text-base font-semibold text-slate-300">{t('ui.deviceManagement.noCctvDevicesFound')}</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {t('ui.deviceManagement.addYourFirstDvrNvrOr')}
            </p>
            <Button onClick={openAddModal} className="mt-4 bg-cyan-600 hover:bg-cyan-500 text-white text-xs">
              <Plus className="w-4 h-4 mr-1" />{' '}{t('ui.deviceManagement.addDevice')}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {filteredDevices.map((dev: any) => {
              const isExpanded = expandedDeviceId === dev.id;
              const hasUnprovisionedChannels = (dev.cameraCount || 0) < (dev.totalChannels || 1);

              return (
                <div key={dev.id} className="transition hover:bg-slate-800/30">
                  <div className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Device Header Info */}
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => setExpandedDeviceId(isExpanded ? null : dev.id)}
                        className="mt-1 p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200 text-sm hover:text-cyan-400 transition cursor-pointer" onClick={() => setExpandedDeviceId(isExpanded ? null : dev.id)}>
                            {dev.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              dev.deviceType === 'dvr'
                                ? 'bg-blue-950 text-blue-400 border border-blue-800/60'
                                : dev.deviceType === 'nvr'
                                ? 'bg-purple-950 text-purple-400 border border-purple-800/60'
                                : 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                            }`}
                          >
                            {dev.deviceType?.toUpperCase()}
                          </span>
                          {dev.brand && (
                            <span className="text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                              {dev.brand} {dev.model || ''}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-400">
                          <span className="font-mono text-cyan-300">{t('ui.deviceManagement.ip')}{' '}{dev.ipAddress}:{dev.rtspPort}</span>
                          <span>{t('ui.deviceManagement.http')}{' '}{dev.httpPort || 80}</span>
                          {dev.onvifPort && <span>{t('ui.deviceManagement.onvif')}{' '}{dev.onvifPort}</span>}
                          {dev.serialNumber && <span>S/N: {dev.serialNumber}</span>}
                          {dev.site && <span className="text-slate-300">{t('ui.deviceManagement.site')}{' '}{dev.site.name}{dev.zone ? ` / ${dev.zone.name}` : ''}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Channel badge and action buttons */}
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <Camera className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-semibold text-slate-200">
                            {dev.enabledChannels?.length ?? 0} / {dev.totalChannels}{' '}{t('ui.deviceManagement.channelsInUseShort')}
                          </span>
                        </div>
                        {hasUnprovisionedChannels && (
                          <span className="text-[10px] text-amber-400 flex items-center gap-1 justify-end mt-0.5">
                            <AlertTriangle className="w-3 h-3" />
                            {dev.totalChannels - (dev.cameraCount || 0)} unprovisioned
                          </span>
                        )}
                      </div>

                      {hasUnprovisionedChannels && (
                        <Button
                          variant="secondary"
                          onClick={() => provisionMutation.mutate(dev.id)}
                          disabled={provisionMutation.isPending}
                          className="text-xs py-1 px-2.5 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-800/50"
                        >
                          {t('ui.deviceManagement.autoProvision')}
                        </Button>
                      )}

                      <button
                        onClick={() => openCloneModal(dev)}
                        className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-cyan-300 transition"
                        title={t('ui.deviceManagement.cloneDevice')}
                        aria-label={t('ui.deviceManagement.cloneDevice')}
                      >
                        <Copy className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => openEditModal(dev)}
                        className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
                        title={t('ui.deviceManagement.editDevice')}
                      >
                        <Edit className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setDeleteTarget(dev)}
                        className="p-1.5 hover:bg-rose-950/60 rounded text-slate-400 hover:text-rose-400 transition"
                        title={t('ui.deviceManagement.deleteDevice')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Channel List / Preview */}
                  {isExpanded && (
                    <div className="px-6 py-4 bg-slate-950/60 border-t border-slate-800/60 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-cyan-400" />
                          {t('ui.deviceManagement.provisionedCameraChannels2')}
                        </h4>
                        <span className="text-xs text-slate-500">
                          {t('ui.deviceManagement.clickChannelToLaunchLowLatency')}
                        </span>
                      </div>

                      <DeviceChannelsPanel deviceId={dev.id} canEdit={canEditChannels} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Device Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={cloneSource ? t('ui.deviceManagement.cloneTitle', { name: cloneSource }) : editingDevice ? t('ui.deviceManagement.editRecordingDevice') : t('ui.deviceManagement.addRecordingDeviceDvrNvrIp')}
      >
        <form onSubmit={handleSubmit} className="space-y-4 text-slate-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.deviceManagement.deviceName')}</label>
              <input
                type="text"
                required
                placeholder={t('ui.deviceManagement.eGMainGateDvrWarehouse')}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.deviceManagement.deviceType')}</label>
              <select
                value={formData.deviceType}
                onChange={(e) => setFormData({ ...formData, deviceType: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {/* A type switched off in master data stays selectable for the device already using it. */}
                {!deviceTypeOptions.some((o) => o.value === formData.deviceType) && (
                  <option value={formData.deviceType}>{formData.deviceType}</option>
                )}
                {deviceTypeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.deviceManagement.vendorBrand')}</label>
              <select
                value={formData.brand}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {brandOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {formData.brand && !brandOptions.some((o) => o.value === formData.brand) && <option value={formData.brand}>{formData.brand}</option>}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.deviceManagement.model')}</label>
              <input
                type="text"
                placeholder={t('ui.deviceManagement.eGDs7216hqhiK')}
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.deviceManagement.shortCode')}</label>
              <input
                type="text"
                data-device-short-code
                value={formData.shortCode}
                maxLength={20}
                placeholder={t('ui.deviceManagement.shortCodePlaceholder')}
                title={t('ui.deviceManagement.shortCodeHint')}
                onChange={(e) => setFormData({ ...formData, shortCode: cleanShortCode(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
              <p className="mt-1 text-[11px] text-slate-500">{t('ui.deviceManagement.shortCodeHint')}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.deviceManagement.totalChannels')}</label>
              <select
                value={formData.totalChannels}
                onChange={(e) => {
                  setFormData({ ...formData, totalChannels: parseInt(e.target.value, 10) });
                  setEnabledChannels(null);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {channelCountOptions.map((o) => <option key={o.value} value={Number(o.value)}>{o.label}</option>)}
                {!channelCountOptions.some((o) => Number(o.value) === formData.totalChannels) && <option value={formData.totalChannels}>{formData.totalChannels}</option>}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300">{t('ui.deviceManagement.ipAddress')}</label>
                <button
                  type="button"
                  onClick={handleProbeDevice}
                  disabled={probeState.loading || !formData.ipAddress}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium disabled:opacity-50"
                >
                  {probeState.loading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Wifi className="w-3 h-3" />
                  )}
                  {t('ui.deviceManagement.testConnection')}
                </button>
              </div>
              <input
                type="text"
                required
                placeholder="192.168.1.100"
                value={formData.ipAddress}
                onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                aria-invalid={!!formData.ipAddress && !ipValid}
                className={`w-full bg-slate-950 border rounded-lg ${formData.ipAddress && !ipValid ? 'border-rose-500' : 'border-slate-800'} px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500`}
              />
              {formData.ipAddress && !ipValid && (
                <p className="mt-1 text-[11px] text-rose-400">{t('ui.deviceManagement.ipInvalid')}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.deviceManagement.rtspPort')}</label>
              <input
                type="number"
                value={formData.rtspPort}
                onChange={(e) => setFormData({ ...formData, rtspPort: parseInt(e.target.value, 10) || 554 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.deviceManagement.httpPort')}</label>
              <input
                type="number"
                value={formData.httpPort}
                onChange={(e) => setFormData({ ...formData, httpPort: parseInt(e.target.value, 10) || 80 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Connection Test Probe Status Banner */}
          {probeState.loading && (
            <div className="p-2.5 rounded-lg bg-cyan-950/40 border border-cyan-800/60 text-xs text-cyan-300 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{t('ui.deviceManagement.probingRtsp')}{formData.rtspPort}{t('ui.deviceManagement.http2')}{formData.httpPort}{t('ui.deviceManagement.on')}{' '}{formData.ipAddress}...</span>
            </div>
          )}

          {probeState.result && (
            <div
              className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                probeState.result.overallStatus === 'online'
                  ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
                  : probeState.result.overallStatus === 'degraded'
                  ? 'bg-amber-950/50 border-amber-800 text-amber-300'
                  : 'bg-rose-950/50 border-rose-800 text-rose-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {probeState.result.overallStatus === 'online' ? (
                  <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : probeState.result.overallStatus === 'degraded' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>
                  {t('ui.deviceManagement.rtsp')}{' '}{probeState.result.reachability.rtsp.reachable ? t('ui.deviceManagement.onlineMs', { latencyMs: probeState.result.reachability.rtsp.latencyMs }) : t('ui.deviceManagement.unreachable')}
                  {' · '}
                  {t('ui.deviceManagement.http')}{' '}{probeState.result.reachability.http.reachable ? t('ui.deviceManagement.onlineMs', { latencyMs: probeState.result.reachability.http.latencyMs }) : t('ui.deviceManagement.unreachable')}
                </span>
              </div>
              <span className="font-semibold uppercase tracking-wider text-[10px]">
                {probeState.result.overallStatus}
              </span>
            </div>
          )}

          {probeState.error && (
            <div className="p-2.5 rounded-lg bg-rose-950/50 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{probeState.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <LocationFields
              siteId={formData.siteId}
              zoneId={formData.zoneId}
              labelClass="block text-xs font-medium text-slate-300 mb-1"
              onChange={(next) => setFormData({ ...formData, ...next })}
            />
            <p className="text-[11px] text-slate-500">{t('ui.location.deviceHint')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.location.description')}</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* RTSP Template Preview */}
          {(() => {
            const tpl = templates.find(
              (t: any) => t.brand?.toLowerCase() === formData.brand.toLowerCase()
            );
            // The path the server will really use for this brand (same patterns as buildChannelRtspUrl).
            const path = (tpl?.mainStreamPattern || '/').replace(/\{channel\}/g, '1');
            const preview = `rtsp://${formData.username || 'admin'}:${formData.password ? '••••••••' : 'password'}@${formData.ipAddress || '192.168.1.100'}:${formData.rtspPort || 554}${path}`;
            return (
              <div className="p-2 bg-slate-950 border border-slate-800/80 rounded-lg text-[11px] font-mono text-slate-400 flex items-center justify-between">
                <span className="truncate">
                  {t('ui.deviceManagement.vendorStreamUrlCh')}{' '}<span className="text-cyan-300">{preview}</span>
                </span>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.deviceManagement.username')}</label>
              <input
                type="text"
                placeholder="admin"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('common.password')}{' '}{editingDevice && t('ui.deviceManagement.leaveBlankToKeepUnchanged')}
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
              {passwordMissing && (
                <p className="mt-1 text-[11px] text-amber-400">{t('ui.deviceManagement.clonePasswordNeeded')}</p>
              )}
            </div>
          </div>

          {!editingDevice && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              <input
                type="checkbox"
                id="autoCreate"
                checked={formData.autoCreateCameras}
                onChange={(e) => setFormData({ ...formData, autoCreateCameras: e.target.checked })}
                className="rounded border-slate-700 bg-slate-950 text-cyan-600 focus:ring-0"
              />
              <label htmlFor="autoCreate" className="text-xs text-slate-300 font-medium cursor-pointer">
                {t('ui.deviceManagement.autoGenerateCameraChannelsForThis')}{' '}{formData.totalChannels})
              </label>
            </div>
          )}
          {!editingDevice && formData.autoCreateCameras && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400">{t('ui.deviceManagement.channelsHint')}</p>
              <ChannelChecklist
                total={formData.totalChannels}
                enabled={enabledChannels ?? Array.from({ length: formData.totalChannels }, (_, i) => i + 1)}
                onChange={setEnabledChannels}
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending || !ipValid || passwordMissing}
              className="bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              {editingDevice ? t('ui.deviceManagement.saveChanges') : t('ui.deviceManagement.createDevice')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('ui.deviceManagement.confirmDeleteDevice')}
      >
        <div className="space-y-4 text-slate-200">
          <p className="text-sm">
            {t('ui.deviceManagement.areYouSureYouWantTo')}{' '}<span className="font-bold text-cyan-400">{deleteTarget?.name}</span>?
          </p>
          {deleteTarget?.cameraCount > 0 && (
            <div className="p-3 bg-amber-950/60 border border-amber-800 rounded-lg text-amber-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {t('ui.deviceManagement.thisDeviceCurrentlyHas')}{' '}{deleteTarget.cameraCount}{' '}{t('ui.deviceManagement.linkedCamerasYouMustReassignOr')}
              </span>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={deleteMutation.isPending || deleteTarget?.cameraCount > 0}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-rose-600 hover:bg-rose-500 text-white"
            >
              {t('common.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk Import Modal */}
      <Modal
        isOpen={isBulkModalOpen}
        onClose={() => {
          setIsBulkModalOpen(false);
          setBulkParsedData([]);
          setBulkParseErrors([]);
          setBulkInputText('');
        }}
        title={t('ui.deviceManagement.bulkImportDevicesDvrNvrIp')}
      >
        <div className="space-y-4 text-slate-200">
          {bulkImportResult ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                  <CheckCircle className="w-5 h-5" />
                  <span>{t('ui.deviceManagement.bulkImportComplete')}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-2 bg-slate-950 rounded-lg border border-slate-800/60">
                    <p className="text-xl font-bold text-slate-100">{bulkImportResult.importedCount}</p>
                    <p className="text-[11px] text-slate-400">{t('ui.deviceManagement.devicesCreated')}</p>
                  </div>
                  <div className="p-2 bg-slate-950 rounded-lg border border-slate-800/60">
                    <p className="text-xl font-bold text-cyan-400">{bulkImportResult.totalCamerasCreated}</p>
                    <p className="text-[11px] text-slate-400">{t('ui.deviceManagement.channelsProvisioned')}</p>
                  </div>
                  <div className="p-2 bg-slate-950 rounded-lg border border-slate-800/60">
                    <p className="text-xl font-bold text-amber-400">{bulkImportResult.failed?.length ?? 0}</p>
                    <p className="text-[11px] text-slate-400">{t('ui.deviceManagement.skippedDuplicate')}</p>
                  </div>
                </div>
                {bulkImportResult.failed?.length > 0 && (
                  <ul className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/40 text-xs text-rose-200 space-y-1 max-h-40 overflow-y-auto">
                    {bulkImportResult.failed.map((f: any, idx: number) => (
                      <li key={idx}><b>{f.name}</b>: {f.message}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    setIsBulkModalOpen(false);
                    setBulkImportResult(null);
                    setBulkParsedData([]);
                    setBulkInputText('');
                  }}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white"
                >
                  {t('ui.deviceManagement.done')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between text-xs">
                <div>
                  <p className="font-semibold text-slate-200">{t('ui.deviceManagement.csvTemplateFormat')}</p>
                  <p className="text-slate-400 text-[11px]">
                    name, ipAddress, brand, deviceType, totalChannels, username, password, rtspPort, httpPort, autoCreateCameras
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      handleDownloadTemplate();
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 font-medium text-xs flex items-center gap-1 transition"
                  >
                    <Download className="w-3.5 h-3.5" />{' '}{t('ui.deviceManagement.downloadTemplate')}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300">{t('ui.deviceManagement.pasteCsvDataOrUploadCsv')}</label>
                  <label className="text-xs text-cyan-400 hover:underline cursor-pointer flex items-center gap-1">
                    <UploadCloud className="w-3.5 h-3.5" />
                    {t('ui.deviceManagement.uploadFile')}
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const text = event.target?.result as string;
                            setBulkInputText(text);
                            parseCsv(text);
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                  </label>
                </div>
                <textarea
                  rows={6}
                  value={bulkInputText}
                  onChange={(e) => {
                    setBulkInputText(e.target.value);
                    parseCsv(e.target.value);
                  }}
                  placeholder={t('ui.deviceManagement.pasteCsvRowsHere')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {bulkParseErrors.length > 0 && (
                <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-xs text-rose-300 space-y-1">
                  <div className="flex items-center gap-1 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" />{' '}{t('ui.deviceManagement.syntaxOrValidationWarnings')}
                  </div>
                  {bulkParseErrors.map((err, idx) => (
                    <p key={idx}>· {err}</p>
                  ))}
                </div>
              )}

              {bulkParsedData.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span className="font-semibold">{t('ui.deviceManagement.preview')}{' '}{bulkParsedData.length}{' '}{t('ui.deviceManagement.devicesToImport')}</span>
                    <span className="text-slate-400">
                      {t('ui.deviceManagement.totalCapacity')}{' '}{bulkParsedData.reduce((s, d) => s + d.totalChannels, 0)} channels
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-slate-800 rounded-lg">
                    <table className="w-full text-[11px] text-left text-slate-300">
                      <thead className="bg-slate-900 text-slate-400 font-semibold sticky top-0">
                        <tr>
                          <th className="p-2">{t('common.name')}</th>
                          <th className="p-2">{t('ui.deviceManagement.ipAddress2')}</th>
                          <th className="p-2">{t('ui.deviceManagement.brand')}</th>
                          <th className="p-2">{t('ui.deviceManagement.channels')}</th>
                          <th className="p-2">{t('ui.deviceManagement.autoCreate')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {bulkParsedData.map((d, i) => (
                          <tr key={i} className="hover:bg-slate-900/40">
                            <td className="p-2 font-medium text-slate-100">{d.name}</td>
                            <td className="p-2 font-mono text-cyan-400">
                              {d.ipAddress}:{d.rtspPort}
                            </td>
                            <td className="p-2">{d.brand}</td>
                            <td className="p-2">{d.totalChannels} ch</td>
                            <td className="p-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] ${
                                  d.autoCreateCameras
                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {d.autoCreateCameras ? t('common.yes') : t('common.no')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <Button variant="secondary" onClick={() => setIsBulkModalOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  disabled={bulkImportMutation.isPending || bulkParsedData.length === 0}
                  onClick={() => bulkImportMutation.mutate(bulkParsedData)}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5"
                >
                  {bulkImportMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t('ui.deviceManagement.import')}{' '}{bulkParsedData.length}{' '}{t('ui.deviceManagement.devices')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
