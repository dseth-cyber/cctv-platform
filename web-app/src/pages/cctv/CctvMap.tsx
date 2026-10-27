import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { imageServiceApi } from '@/services/imageServiceApi';
import { WhepPlayer } from '@/components/cctv/WhepPlayer';
import {
  MapPin,
  Building2,
  Layers,
  Search,
  Maximize2,
  Radio,
  Eye,
  Sliders,
  AlertCircle,
  CheckCircle2,
  HardDrive,
  Compass,
  Plus,
  Move,
  X,
  ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CameraPin {
  id: string;
  name: string;
  ipAddress?: string;
  channelNumber?: number;
  operationalStatus: string;
  latitude?: number | null;
  longitude?: number | null;
  streamPath?: string;
  siteId?: string;
  zoneId?: string;
  device?: { name: string; brand?: string };
}

export default function CctvMap() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedSiteId, setSelectedSiteId] = useState<string>('all');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCamera, setSelectedCamera] = useState<CameraPin | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'floorplan' | 'list'>('floorplan');

  // Queries
  const { data: sites = [] } = useQuery({
    queryKey: ['cctv-sites'],
    queryFn: () => imageServiceApi.getSites(),
  });

  const { data: cameras = [], isLoading: isLoadingCameras } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => imageServiceApi.getCameras({ enabled: true }),
  });

  // Selected site object
  const currentSite = sites.find((s: any) => s.id === selectedSiteId);
  const zonesForSite = currentSite?.zones || [];

  // Filter cameras
  const filteredCameras = cameras.filter((cam: any) => {
    const matchSite = selectedSiteId === 'all' || cam.siteId === selectedSiteId;
    const matchZone = selectedZoneId === 'all' || cam.zoneId === selectedZoneId;
    const matchSearch =
      cam.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cam.ipAddress?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchSite && matchZone && matchSearch;
  });

  // Position update mutation
  const updatePositionMutation = useMutation({
    mutationFn: ({ id, lat, lng }: { id: string; lat: number; lng: number }) =>
      imageServiceApi.updateCamera(id, { latitude: lat, longitude: lng }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    },
  });

  // Canvas click to place camera in edit mode
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditMode || !selectedCamera) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    updatePositionMutation.mutate({
      id: selectedCamera.id,
      lat: Number(y.toFixed(2)),
      lng: Number(x.toFixed(2)),
    });
  };

  // View stream
  const handleSelectCameraPin = async (cam: CameraPin) => {
    setSelectedCamera(cam);
    try {
      const data = await imageServiceApi.getCameraStream(cam.id);
      setStreamUrl(data.webrtcWhepUrl || `/mediamtx/webrtc/${cam.streamPath}/whep`);
    } catch {
      setStreamUrl(`/mediamtx/webrtc/${cam.streamPath || `cam_${cam.id.substring(0, 8)}`}/whep`);
    }
  };

  const onlineCount = filteredCameras.filter((c: any) => c.operationalStatus === 'online').length;
  const offlineCount = filteredCameras.filter((c: any) => c.operationalStatus === 'offline').length;

  return (
    <div className="h-[calc(100vh-60px)] flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Top Toolbar */}
      <div className="h-14 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-cyan-400" />
            <h1 className="text-base font-bold tracking-tight text-slate-100">
              Interactive CCTV Map
            </h1>
          </div>
          <span className="hidden sm:inline-block text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-400 border border-slate-700">
            Spatial Floor Plan
          </span>
        </div>

        {/* Site & Zone Selectors */}
        <div className="flex items-center gap-2">
          {/* Site Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedSiteId}
              onChange={(e) => {
                setSelectedSiteId(e.target.value);
                setSelectedZoneId('all');
              }}
              className="bg-transparent text-xs text-slate-200 focus:outline-none"
            >
              <option value="all" className="bg-slate-900">
                All Sites ({cameras.length} cams)
              </option>
              {sites.map((s: any) => (
                <option key={s.id} value={s.id} className="bg-slate-900">
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Zone Selector */}
          {zonesForSite.length > 0 && (
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                className="bg-transparent text-xs text-slate-200 focus:outline-none"
              >
                <option value="all" className="bg-slate-900">
                  All Zones / Floors
                </option>
                {zonesForSite.map((z: any) => (
                  <option key={z.id} value={z.id} className="bg-slate-900">
                    {z.name} (Floor {z.floor || 1})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Edit Mode Toggle */}
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition ${
              isEditMode
                ? 'bg-amber-600 text-white border-amber-500 shadow-lg shadow-amber-950/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            <Move className="w-3.5 h-3.5" />
            <span>{isEditMode ? 'Done Positioning' : 'Edit Pins'}</span>
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Map / Floor Plan Canvas */}
        <div className="flex-1 flex flex-col relative bg-slate-950 overflow-hidden">
          {/* Spatial Blueprint Canvas */}
          <div
            onClick={handleCanvasClick}
            className={`flex-1 relative overflow-hidden bg-slate-950 flex items-center justify-center ${
              isEditMode ? 'cursor-crosshair' : ''
            }`}
            style={{
              backgroundImage: `
                radial-gradient(circle at 1px 1px, rgba(56, 189, 248, 0.08) 1px, transparent 0),
                linear-gradient(to right, rgba(51, 65, 85, 0.1) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(51, 65, 85, 0.1) 1px, transparent 1px)
              `,
              backgroundSize: '32px 32px, 64px 64px, 64px 64px',
            }}
          >
            {/* Visual Floor Outline Placeholder / Grid */}
            <div className="absolute inset-8 rounded-3xl border border-dashed border-slate-800/80 pointer-events-none flex flex-col justify-between p-6">
              <div className="flex justify-between text-[11px] font-mono text-slate-600 uppercase tracking-widest">
                <span>
                  {currentSite?.name || 'All Sites Floor Plan'} — Zone Canvas
                </span>
                <span>Coordinates: 0.00% – 100.00%</span>
              </div>
              <div className="flex justify-between text-[11px] font-mono text-slate-600 uppercase tracking-widest">
                <span>Security Perimeter Grid</span>
                <span>{filteredCameras.length} Plotted Cameras</span>
              </div>
            </div>

            {/* Placed Camera Pins */}
            {filteredCameras.map((cam: any, index: number) => {
              // If camera has saved coordinates (latitude = y%, longitude = x%), use them.
              // Otherwise generate a deterministic staggered layout for unplaced cameras.
              const posX =
                cam.longitude !== null && cam.longitude !== undefined
                  ? cam.longitude
                  : 12 + ((index * 13) % 76);
              const posY =
                cam.latitude !== null && cam.latitude !== undefined
                  ? cam.latitude
                  : 15 + ((index * 17) % 70);

              const isSelected = selectedCamera?.id === cam.id;
              const isOnline = cam.operationalStatus === 'online';

              return (
                <div
                  key={cam.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectCameraPin(cam);
                  }}
                  style={{
                    left: `${posX}%`,
                    top: `${posY}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  className={`absolute z-20 cursor-pointer group transition-transform ${
                    isSelected ? 'scale-125 z-30' : 'hover:scale-115'
                  }`}
                >
                  {/* FOV Direction Cone Indicator */}
                  <div className="w-8 h-8 rounded-full flex items-center justify-center relative">
                    {/* Pulsing ring for online */}
                    <div
                      className={`absolute inset-0 rounded-full animate-ping opacity-25 ${
                        isOnline ? 'bg-emerald-400' : 'bg-rose-500'
                      }`}
                    />

                    {/* Camera Pin Body */}
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shadow-lg border transition ${
                        isSelected
                          ? 'bg-cyan-500 border-white text-slate-950'
                          : isOnline
                          ? 'bg-slate-900 border-emerald-500 text-emerald-400'
                          : 'bg-slate-900 border-rose-500 text-rose-400'
                      }`}
                    >
                      <Radio className="w-3.5 h-3.5" />
                    </div>
                  </div>

                  {/* Label tooltip */}
                  <div
                    className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap shadow-md pointer-events-none transition ${
                      isSelected
                        ? 'bg-cyan-600 text-white'
                        : 'bg-slate-900/90 text-slate-300 border border-slate-800'
                    }`}
                  >
                    {cam.name}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom Bar: Stats & Edit Mode Hint */}
          <div className="h-10 px-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="text-slate-400">Total: {filteredCameras.length}</span>
              <span className="text-emerald-400">Online: {onlineCount}</span>
              {offlineCount > 0 && <span className="text-rose-400">Offline: {offlineCount}</span>}
            </div>

            {isEditMode ? (
              <span className="text-amber-400 animate-pulse font-sans font-semibold">
                Click any camera on the list, then click on the map to set its position!
              </span>
            ) : (
              <span className="text-slate-500 font-sans">
                Click any camera pin to preview live stream
              </span>
            )}
          </div>
        </div>

        {/* Right Sidebar: Selected Camera Details & Live WHEP Player */}
        <aside className="w-96 bg-slate-900 border-l border-slate-800 flex flex-col shrink-0 z-30">
          {/* Header */}
          <div className="p-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-200">
                {selectedCamera ? selectedCamera.name : 'Camera Inspector'}
              </h3>
            </div>
            {selectedCamera && (
              <button
                onClick={() => {
                  setSelectedCamera(null);
                  setStreamUrl(null);
                }}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Content */}
          {selectedCamera ? (
            <div className="flex-1 flex flex-col p-3 space-y-3 overflow-auto">
              {/* Live Video Player */}
              <div className="w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-video">
                {streamUrl ? (
                  <WhepPlayer
                    streamUrl={streamUrl}
                    cameraName={selectedCamera.name}
                    className="w-full h-full"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
                    <Radio className="w-6 h-6 animate-pulse mb-2 text-cyan-400" />
                    <span className="text-xs">Loading Live WebRTC Stream...</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => navigate('/image-service/live-grid')}
                  className="flex-1 py-1.5 px-3 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open in Live Wall</span>
                </button>
              </div>

              {/* Meta details */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <span
                    className={`font-semibold flex items-center gap-1 ${
                      selectedCamera.operationalStatus === 'online'
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        selectedCamera.operationalStatus === 'online'
                          ? 'bg-emerald-400'
                          : 'bg-rose-500'
                      }`}
                    />
                    {selectedCamera.operationalStatus}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">IP Address</span>
                  <span className="font-mono text-slate-300">
                    {selectedCamera.ipAddress || '—'}
                  </span>
                </div>
                {selectedCamera.channelNumber && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">DVR Channel</span>
                    <span className="font-mono text-slate-300">
                      Ch #{selectedCamera.channelNumber}
                    </span>
                  </div>
                )}
                {selectedCamera.latitude !== null && selectedCamera.latitude !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Coordinates (Y, X)</span>
                    <span className="font-mono text-cyan-400">
                      {selectedCamera.latitude}%, {selectedCamera.longitude}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
              <MapPin className="w-10 h-10 stroke-1 text-slate-600 mb-2" />
              <p className="text-xs font-medium text-slate-400">No Camera Selected</p>
              <p className="text-[11px] text-slate-600 mt-1 max-w-[200px]">
                Click on any camera pin on the floor plan to view details and live stream.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
