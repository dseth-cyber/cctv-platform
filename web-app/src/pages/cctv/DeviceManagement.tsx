import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from 'lucide-react';
import { WhepPlayer } from '@/components/cctv/WhepPlayer';

export default function DeviceManagement() {
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
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
    ipAddress: '',
    rtspPort: 554,
    httpPort: 80,
    onvifPort: 8000,
    username: 'admin',
    password: '',
    totalChannels: 16,
    autoCreateCameras: true,
  });

  // Queries
  const { data: devices = [], isLoading, refetch } = useQuery({
    queryKey: ['cctv-devices', selectedType],
    queryFn: () => imageServiceApi.getDevices(selectedType !== 'all' ? { deviceType: selectedType } : undefined),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['cctv-device-templates'],
    queryFn: () => imageServiceApi.getDeviceTemplates(),
  });

  const { data: streamInfo, isLoading: isLoadingStream } = useQuery({
    queryKey: ['camera-stream', previewCamera?.id],
    queryFn: () => (previewCamera ? imageServiceApi.getCameraStream(previewCamera.id) : null),
    enabled: Boolean(previewCamera?.id),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => imageServiceApi.createDevice(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      toast.success('Device added successfully');
      setIsModalOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to create device');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateDevice(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      toast.success('Device updated');
      setIsModalOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to update device');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteDevice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      toast.success('Device removed');
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to delete device');
    },
  });

  const provisionMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.provisionDeviceChannels(id),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      toast.success(`Provisioned ${res.provisionedCount} camera channels`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to provision channels');
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: (data: any[]) => imageServiceApi.bulkImportDevices(data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setBulkImportResult(res);
      toast.success(`Bulk import completed: ${res.createdCount} devices created, ${res.provisionedCamerasCount} channels provisioned`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Bulk import failed');
    },
  });

  const handleProbeDevice = async () => {
    if (!formData.ipAddress) {
      toast.error('Please enter an IP address to test');
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
        rtspPort: tpl.rtspPort || prev.rtspPort,
        httpPort: tpl.httpPort || prev.httpPort,
        onvifPort: tpl.onvifPort || prev.onvifPort,
        username: tpl.defaultUsername || prev.username,
      }));
    } else {
      setFormData((prev) => ({ ...prev, brand: vendorName }));
    }
  };

  const parseCsv = (csvText: string) => {
    const lines = csvText.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      setBulkParseErrors(['CSV must contain a header row and at least 1 record']);
      setBulkParsedData([]);
      return;
    }

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const required = ['name', 'ipaddress'];
    const missing = required.filter((r) => !headers.includes(r));
    if (missing.length > 0) {
      setBulkParseErrors([`Missing required headers: ${missing.join(', ')}`]);
      setBulkParsedData([]);
      return;
    }

    const items: any[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      if (cols.length === 1 && cols[0] === '') continue;
      const row: Record<string, any> = {};
      headers.forEach((h, idx) => {
        row[h] = cols[idx] !== undefined ? cols[idx] : '';
      });

      if (!row.name || !row.ipaddress) {
        errors.push(`Row ${i + 1}: Name and IP address are required`);
        continue;
      }

      items.push({
        name: row.name,
        ipAddress: row.ipaddress,
        brand: row.brand || 'Generic',
        deviceType: row.devicetype || 'dvr',
        model: row.model || '',
        serialNumber: row.serialnumber || '',
        totalChannels: parseInt(row.totalchannels, 10) || 16,
        username: row.username || 'admin',
        password: row.password || '',
        rtspPort: parseInt(row.rtspport, 10) || 554,
        httpPort: parseInt(row.httpport, 10) || 80,
        onvifPort: parseInt(row.onvifport, 10) || 8000,
        autoCreateCameras:
          row.autocreatecameras !== undefined
            ? String(row.autocreatecameras).toLowerCase() === 'true'
            : true,
      });
    }

    setBulkParseErrors(errors);
    setBulkParsedData(items);
  };

  const sampleCsv = `name,ipAddress,brand,deviceType,totalChannels,username,password,rtspPort,httpPort,autoCreateCameras
Main Gate DVR,192.168.1.101,Hikvision,dvr,16,admin,Pass1234,554,80,true
Warehouse NVR,192.168.1.102,Dahua,nvr,32,admin,Pass1234,554,80,true
Office Floor 1 NVR,192.168.1.103,Uniview,nvr,16,admin,Pass1234,554,80,true
Perimeter Cam 01,192.168.1.104,Generic,ip_camera,1,admin,Pass1234,554,80,true`;

  const resetForm = () => {
    setEditingDevice(null);
    setProbeState({ loading: false, result: null, error: null });
    setFormData({
      name: '',
      description: '',
      deviceType: 'dvr',
      brand: 'Hikvision',
      model: '',
      serialNumber: '',
      ipAddress: '',
      rtspPort: 554,
      httpPort: 80,
      onvifPort: 8000,
      username: 'admin',
      password: '',
      totalChannels: 16,
      autoCreateCameras: true,
    });
  };

  const openAddModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (dev: any) => {
    setEditingDevice(dev);
    setProbeState({ loading: false, result: null, error: null });
    setFormData({
      name: dev.name,
      description: dev.description || '',
      deviceType: dev.deviceType || 'dvr',
      brand: dev.brand || 'Generic',
      model: dev.model || '',
      serialNumber: dev.serialNumber || '',
      ipAddress: dev.ipAddress || '',
      rtspPort: dev.rtspPort || 554,
      httpPort: dev.httpPort || 80,
      onvifPort: dev.onvifPort || 8000,
      username: dev.username || 'admin',
      password: '',
      totalChannels: dev.totalChannels || 16,
      autoCreateCameras: false,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingDevice) {
      const payload: any = { ...formData };
      if (!payload.password) delete payload.password;
      delete payload.autoCreateCameras;
      updateMutation.mutate({ id: editingDevice.id, data: payload });
    } else {
      createMutation.mutate(formData);
    }
  };

  // Filtered devices
  const filteredDevices = devices.filter((d: any) => {
    const term = searchTerm.toLowerCase();
    const matchSearch =
      d.name.toLowerCase().includes(term) ||
      d.ipAddress?.toLowerCase().includes(term) ||
      d.brand?.toLowerCase().includes(term) ||
      d.serialNumber?.toLowerCase().includes(term);
    return matchSearch;
  });

  // Aggregate stats
  const totalChannelsCount = devices.reduce((sum: number, d: any) => sum + (d.totalChannels || 0), 0);
  const totalProvisionedCount = devices.reduce((sum: number, d: any) => sum + (d.cameraCount || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase bg-cyan-950 text-cyan-400 border border-cyan-800">
              CCTV Platform
            </span>
            <span className="text-xs text-slate-400">· Phase 1 Foundation</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 mt-1 flex items-center gap-2">
            <HardDrive className="w-6 h-6 text-cyan-400" />
            Device Management (DVR / NVR / IP Cam)
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Manage recording units, configure vendor RTSP profiles, and auto-provision camera channels
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
            Bulk Import (CSV)
          </Button>
          <Button variant="secondary" onClick={() => refetch()} className="flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={openAddModal} className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white">
            <Plus className="w-4 h-4" />
            Add Device
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">Total Devices</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">{devices.length}</p>
          </div>
          <div className="p-3 bg-cyan-950/70 border border-cyan-800/50 rounded-lg text-cyan-400">
            <Server className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">Total Channel Capacity</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">{totalChannelsCount} Ch</p>
          </div>
          <div className="p-3 bg-indigo-950/70 border border-indigo-800/50 rounded-lg text-indigo-400">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">Active Cameras</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{totalProvisionedCount} Cams</p>
          </div>
          <div className="p-3 bg-emerald-950/70 border border-emerald-800/50 rounded-lg text-emerald-400">
            <Camera className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">MediaMTX Gateway</p>
            <p className="text-sm font-semibold text-cyan-400 mt-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              On-Demand WHEP
            </p>
          </div>
          <div className="p-3 bg-amber-950/70 border border-amber-800/50 rounded-lg text-amber-400">
            <Radio className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name, IP, brand, S/N..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400 font-medium">Type:</span>
          {['all', 'dvr', 'nvr', 'ip_camera'].map((type) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-3 py-1 text-xs font-medium rounded-lg border transition capitalize ${
                selectedType === type
                  ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {type === 'all' ? 'All Types' : type.replace('_', ' ').toUpperCase()}
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
            <p className="text-base font-semibold text-slate-300">No CCTV devices found</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Add your first DVR, NVR, or IP camera to start streaming through MediaMTX
            </p>
            <Button onClick={openAddModal} className="mt-4 bg-cyan-600 hover:bg-cyan-500 text-white text-xs">
              <Plus className="w-4 h-4 mr-1" /> Add Device
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
                          <span className="font-mono text-cyan-300">IP: {dev.ipAddress}:{dev.rtspPort}</span>
                          <span>HTTP: {dev.httpPort || 80}</span>
                          {dev.onvifPort && <span>ONVIF: {dev.onvifPort}</span>}
                          {dev.serialNumber && <span>S/N: {dev.serialNumber}</span>}
                          {dev.site && <span className="text-slate-300">Site: {dev.site.name}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Channel badge and action buttons */}
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <Camera className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-semibold text-slate-200">
                            {dev.cameraCount || 0} / {dev.totalChannels} Channels
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
                          Auto-Provision
                        </Button>
                      )}

                      <button
                        onClick={() => openEditModal(dev)}
                        className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
                        title="Edit device"
                      >
                        <Edit className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setDeleteTarget(dev)}
                        className="p-1.5 hover:bg-rose-950/60 rounded text-slate-400 hover:text-rose-400 transition"
                        title="Delete device"
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
                          Provisioned Camera Channels
                        </h4>
                        <span className="text-xs text-slate-500">
                          Click channel to launch low-latency WebRTC live stream
                        </span>
                      </div>

                      {/* Live Stream Pop-up / Drawer if camera selected */}
                      {previewCamera && (
                        <div className="p-4 bg-slate-900 border border-cyan-800/50 rounded-xl space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                              Live Preview: {previewCamera.name}
                            </span>
                            <button
                              onClick={() => setPreviewCamera(null)}
                              className="text-xs text-slate-400 hover:text-slate-200"
                            >
                              Close Preview ✕
                            </button>
                          </div>
                          {streamInfo?.webrtcWhepUrl ? (
                            <WhepPlayer
                              streamUrl={streamInfo.webrtcWhepUrl}
                              cameraName={previewCamera.name}
                              className="w-full max-w-2xl mx-auto"
                            />
                          ) : (
                            <div className="py-8 text-center text-xs text-slate-400">
                              {isLoadingStream ? 'Fetching MediaMTX Stream URL...' : 'No RTSP stream URL configured for this channel.'}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Channels Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                        {Array.from({ length: dev.totalChannels }).map((_, idx) => {
                          const ch = idx + 1;
                          const isProvisioned = ch <= (dev.cameraCount || 0);

                          return (
                            <div
                              key={ch}
                              onClick={() => {
                                if (isProvisioned) {
                                  // Set preview
                                  setPreviewCamera({
                                    id: `${dev.id}-ch${ch}`, // Or real camera ID
                                    name: `${dev.name} - Ch ${ch}`,
                                  });
                                }
                              }}
                              className={`p-2.5 rounded-lg border text-center transition cursor-pointer select-none ${
                                isProvisioned
                                  ? 'bg-slate-900/90 border-slate-700/80 hover:border-cyan-500 hover:bg-slate-800'
                                  : 'bg-slate-950/40 border-dashed border-slate-800 text-slate-600'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-mono text-slate-400">CH {ch}</span>
                                {isProvisioned ? (
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                ) : (
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                                )}
                              </div>
                              <p className="text-xs font-semibold text-slate-200 truncate">
                                {isProvisioned ? `Cam ${ch}` : 'Empty'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
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
        title={editingDevice ? 'Edit Recording Device' : 'Add Recording Device (DVR / NVR / IP Cam)'}
      >
        <form onSubmit={handleSubmit} className="space-y-4 text-slate-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Device Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Main Gate DVR, Warehouse NVR"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Device Type</label>
              <select
                value={formData.deviceType}
                onChange={(e) => setFormData({ ...formData, deviceType: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="dvr">DVR (Digital Video Recorder - Coaxial/BNC)</option>
                <option value="nvr">NVR (Network Video Recorder - IP/PoE)</option>
                <option value="ip_camera">Stand-alone IP Camera</option>
                <option value="other">Other / Hybrid</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Vendor / Brand</label>
              <select
                value={formData.brand}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="Hikvision">Hikvision / HiLook</option>
                <option value="Dahua">Dahua / IMOU</option>
                <option value="Uniview">Uniview (UNV)</option>
                <option value="Generic">Generic / Other RTSP</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Model</label>
              <input
                type="text"
                placeholder="e.g. DS-7216HQHI-K1"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Total Channels</label>
              <select
                value={formData.totalChannels}
                onChange={(e) => setFormData({ ...formData, totalChannels: parseInt(e.target.value, 10) })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value={1}>1 Channel</option>
                <option value={4}>4 Channels</option>
                <option value={8}>8 Channels</option>
                <option value={16}>16 Channels</option>
                <option value={32}>32 Channels</option>
                <option value={64}>64 Channels</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-300">IP Address *</label>
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
                  Test Connection
                </button>
              </div>
              <input
                type="text"
                required
                placeholder="192.168.1.100"
                value={formData.ipAddress}
                onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">RTSP Port</label>
              <input
                type="number"
                value={formData.rtspPort}
                onChange={(e) => setFormData({ ...formData, rtspPort: parseInt(e.target.value, 10) || 554 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">HTTP Port</label>
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
              <span>Probing RTSP ({formData.rtspPort}) & HTTP ({formData.httpPort}) on {formData.ipAddress}...</span>
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
                  RTSP: {probeState.result.reachability.rtsp.reachable ? `Online (${probeState.result.reachability.rtsp.latencyMs}ms)` : 'Unreachable'}
                  {' · '}
                  HTTP: {probeState.result.reachability.http.reachable ? `Online (${probeState.result.reachability.http.latencyMs}ms)` : 'Unreachable'}
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

          {/* RTSP Template Preview */}
          {(() => {
            const tpl = templates.find(
              (t: any) => t.brand?.toLowerCase() === formData.brand.toLowerCase()
            );
            const pattern = tpl?.mainStreamTemplate || 'rtsp://{username}:{password}@{ip}:{port}/live/ch{ch}';
            const preview = pattern
              .replace('{username}', formData.username || 'admin')
              .replace('{password}', formData.password ? '••••••••' : 'password')
              .replace('{ip}', formData.ipAddress || '192.168.1.100')
              .replace('{port}', String(formData.rtspPort || 554))
              .replace('{ch}', '1');
            return (
              <div className="p-2 bg-slate-950 border border-slate-800/80 rounded-lg text-[11px] font-mono text-slate-400 flex items-center justify-between">
                <span className="truncate">
                  Vendor Stream URL (Ch 1): <span className="text-cyan-300">{preview}</span>
                </span>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Username</label>
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
                Password {editingDevice && '(Leave blank to keep unchanged)'}
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
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
                Auto-generate camera channels for this device immediately (Channels 1 to {formData.totalChannels})
              </label>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              {editingDevice ? 'Save Changes' : 'Create Device'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Confirm Delete Device"
      >
        <div className="space-y-4 text-slate-200">
          <p className="text-sm">
            Are you sure you want to delete <span className="font-bold text-cyan-400">{deleteTarget?.name}</span>?
          </p>
          {deleteTarget?.cameraCount > 0 && (
            <div className="p-3 bg-amber-950/60 border border-amber-800 rounded-lg text-amber-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                This device currently has {deleteTarget.cameraCount} linked cameras. You must reassign or remove the cameras before deleting this device.
              </span>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-3">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={deleteMutation.isPending || deleteTarget?.cameraCount > 0}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-rose-600 hover:bg-rose-500 text-white"
            >
              Confirm Delete
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
        title="Bulk Import Devices (DVR / NVR / IP Cam)"
      >
        <div className="space-y-4 text-slate-200">
          {bulkImportResult ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                  <CheckCircle className="w-5 h-5" />
                  <span>Bulk Import Complete</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-2 bg-slate-950 rounded-lg border border-slate-800/60">
                    <p className="text-xl font-bold text-slate-100">{bulkImportResult.createdCount}</p>
                    <p className="text-[11px] text-slate-400">Devices Created</p>
                  </div>
                  <div className="p-2 bg-slate-950 rounded-lg border border-slate-800/60">
                    <p className="text-xl font-bold text-cyan-400">{bulkImportResult.provisionedCamerasCount}</p>
                    <p className="text-[11px] text-slate-400">Channels Provisioned</p>
                  </div>
                  <div className="p-2 bg-slate-950 rounded-lg border border-slate-800/60">
                    <p className="text-xl font-bold text-amber-400">{bulkImportResult.skippedCount}</p>
                    <p className="text-[11px] text-slate-400">Skipped (Duplicate)</p>
                  </div>
                </div>
                {bulkImportResult.results?.length > 0 && (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 text-xs pt-2">
                    {bulkImportResult.results.map((r: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded bg-slate-950/80 border border-slate-800"
                      >
                        <span className="font-mono text-slate-300">
                          {r.name} ({r.ipAddress})
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            r.status === 'created'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : r.status === 'skipped'
                              ? 'bg-amber-950 text-amber-400 border border-amber-800'
                              : 'bg-rose-950 text-rose-400 border border-rose-800'
                          }`}
                        >
                          {r.status}: {r.provisionedCameras ? `${r.provisionedCameras} ch` : r.error || 'ok'}
                        </span>
                      </div>
                    ))}
                  </div>
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
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between text-xs">
                <div>
                  <p className="font-semibold text-slate-200">CSV Template Format</p>
                  <p className="text-slate-400 text-[11px]">
                    name, ipAddress, brand, deviceType, totalChannels, username, password, rtspPort, httpPort, autoCreateCameras
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(sampleCsv);
                      toast.success('Sample CSV copied to clipboard');
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 font-medium text-xs flex items-center gap-1 transition"
                  >
                    <Download className="w-3.5 h-3.5" /> Copy Sample
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300">Paste CSV Data or Upload .csv File</label>
                  <label className="text-xs text-cyan-400 hover:underline cursor-pointer flex items-center gap-1">
                    <UploadCloud className="w-3.5 h-3.5" />
                    Upload File
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
                  placeholder="Paste CSV rows here..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {bulkParseErrors.length > 0 && (
                <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-xs text-rose-300 space-y-1">
                  <div className="flex items-center gap-1 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" /> Syntax or Validation Warnings:
                  </div>
                  {bulkParseErrors.map((err, idx) => (
                    <p key={idx}>· {err}</p>
                  ))}
                </div>
              )}

              {bulkParsedData.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span className="font-semibold">Preview: {bulkParsedData.length} Devices to import</span>
                    <span className="text-slate-400">
                      Total capacity: {bulkParsedData.reduce((s, d) => s + d.totalChannels, 0)} channels
                    </span>
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-slate-800 rounded-lg">
                    <table className="w-full text-[11px] text-left text-slate-300">
                      <thead className="bg-slate-900 text-slate-400 font-semibold sticky top-0">
                        <tr>
                          <th className="p-2">Name</th>
                          <th className="p-2">IP Address</th>
                          <th className="p-2">Brand</th>
                          <th className="p-2">Channels</th>
                          <th className="p-2">Auto-create</th>
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
                                {d.autoCreateCameras ? 'Yes' : 'No'}
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
                  Cancel
                </Button>
                <Button
                  disabled={bulkImportMutation.isPending || bulkParsedData.length === 0}
                  onClick={() => bulkImportMutation.mutate(bulkParsedData)}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1.5"
                >
                  {bulkImportMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Import {bulkParsedData.length} Devices
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
