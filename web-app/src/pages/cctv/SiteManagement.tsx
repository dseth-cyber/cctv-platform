import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Button, Modal, TableSkeleton } from '@/components/ui';
import {
  MapPin,
  Plus,
  RefreshCw,
  Building2,
  Layers,
  Camera,
  Edit,
  Trash2,
  HardDrive,
  Map,
  Search,
} from 'lucide-react';

export default function SiteManagement() {
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState('');
  const [siteModalOpen, setSiteModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<any | null>(null);
  const [deleteSiteTarget, setDeleteSiteTarget] = useState<any | null>(null);

  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [zoneParentSite, setZoneParentSite] = useState<any | null>(null);
  const [editingZone, setEditingZone] = useState<any | null>(null);
  const [deleteZoneTarget, setDeleteZoneTarget] = useState<any | null>(null);

  // Form states
  const [siteForm, setSiteForm] = useState({
    name: '',
    code: '',
    description: '',
    address: '',
  });

  const [zoneForm, setZoneForm] = useState({
    siteId: '',
    name: '',
    code: '',
    floor: 1,
    floorPlanImageUrl: '',
  });

  // Queries
  const { data: sites = [], isLoading, refetch } = useQuery({
    queryKey: ['cctv-sites'],
    queryFn: () => imageServiceApi.getSites(),
  });

  // Site Mutations
  const createSiteMutation = useMutation({
    mutationFn: (data: typeof siteForm) => imageServiceApi.createSite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success('Site created successfully');
      setSiteModalOpen(false);
      resetSiteForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to create site');
    },
  });

  const updateSiteMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateSite(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success('Site updated');
      setSiteModalOpen(false);
      resetSiteForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to update site');
    },
  });

  const deleteSiteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteSite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success('Site deleted');
      setDeleteSiteTarget(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to delete site');
    },
  });

  // Zone Mutations
  const createZoneMutation = useMutation({
    mutationFn: (data: typeof zoneForm) => imageServiceApi.createZone(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success('Zone added');
      setZoneModalOpen(false);
      resetZoneForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to add zone');
    },
  });

  const updateZoneMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateZone(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success('Zone updated');
      setZoneModalOpen(false);
      resetZoneForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to update zone');
    },
  });

  const deleteZoneMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteZone(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success('Zone deleted');
      setDeleteZoneTarget(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to delete zone');
    },
  });

  const resetSiteForm = () => {
    setEditingSite(null);
    setSiteForm({ name: '', code: '', description: '', address: '' });
  };

  const resetZoneForm = () => {
    setEditingZone(null);
    setZoneParentSite(null);
    setZoneForm({ siteId: '', name: '', code: '', floor: 1, floorPlanImageUrl: '' });
  };

  const openAddSiteModal = () => {
    resetSiteForm();
    setSiteModalOpen(true);
  };

  const openEditSiteModal = (site: any) => {
    setEditingSite(site);
    setSiteForm({
      name: site.name,
      code: site.code || '',
      description: site.description || '',
      address: site.address || '',
    });
    setSiteModalOpen(true);
  };

  const openAddZoneModal = (site: any) => {
    resetZoneForm();
    setZoneParentSite(site);
    setZoneForm({
      siteId: site.id,
      name: '',
      code: '',
      floor: 1,
      floorPlanImageUrl: '',
    });
    setZoneModalOpen(true);
  };

  const openEditZoneModal = (site: any, zone: any) => {
    setZoneParentSite(site);
    setEditingZone(zone);
    setZoneForm({
      siteId: site.id,
      name: zone.name,
      code: zone.code || '',
      floor: zone.floor || 1,
      floorPlanImageUrl: zone.floorPlanImageUrl || '',
    });
    setZoneModalOpen(true);
  };

  const handleSiteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSite) {
      updateSiteMutation.mutate({ id: editingSite.id, data: siteForm });
    } else {
      createSiteMutation.mutate(siteForm);
    }
  };

  const handleZoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingZone) {
      updateZoneMutation.mutate({ id: editingZone.id, data: zoneForm });
    } else {
      createZoneMutation.mutate(zoneForm);
    }
  };

  const filteredSites = sites.filter((s: any) => {
    const term = searchTerm.toLowerCase();
    return s.name.toLowerCase().includes(term) || s.code?.toLowerCase().includes(term) || s.address?.toLowerCase().includes(term);
  });

  const totalZonesCount = sites.reduce((sum: number, s: any) => sum + (s.zones?.length || 0), 0);
  const totalCamerasCount = sites.reduce((sum: number, s: any) => sum + (s._count?.cameras || 0), 0);

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
            <Building2 className="w-6 h-6 text-cyan-400" />
            Physical Hierarchy (Sites & Zones)
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Organize branch locations, buildings, floors, and physical security zones
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => refetch()} className="flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={openAddSiteModal} className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white">
            <Plus className="w-4 h-4" />
            Add Site
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">Total Sites / Buildings</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">{sites.length}</p>
          </div>
          <div className="p-3 bg-cyan-950/70 border border-cyan-800/50 rounded-lg text-cyan-400">
            <Building2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">Total Security Zones</p>
            <p className="text-2xl font-bold text-indigo-400 mt-1">{totalZonesCount} Zones</p>
          </div>
          <div className="p-3 bg-indigo-950/70 border border-indigo-800/50 rounded-lg text-indigo-400">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">Cameras Assigned</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{totalCamerasCount} Cams</p>
          </div>
          <div className="p-3 bg-emerald-950/70 border border-emerald-800/50 rounded-lg text-emerald-400">
            <Camera className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search sites by name, code, address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
          />
        </div>
      </div>

      {/* Sites List */}
      <div className="space-y-4">
        {isLoading ? (
          <TableSkeleton rows={3} cols={4} />
        ) : filteredSites.length === 0 ? (
          <div className="py-16 text-center text-slate-400 bg-slate-900/40 border border-slate-800 rounded-xl">
            <Building2 className="w-12 h-12 mx-auto text-slate-600 mb-3" />
            <p className="text-base font-semibold text-slate-300">No Sites or Locations configured</p>
            <p className="text-xs text-slate-500 mt-1">Create your first site to group cameras and physical zones</p>
            <Button onClick={openAddSiteModal} className="mt-4 bg-cyan-600 hover:bg-cyan-500 text-white text-xs">
              <Plus className="w-4 h-4 mr-1" /> Add Site
            </Button>
          </div>
        ) : (
          filteredSites.map((site: any) => (
            <div key={site.id} className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
              {/* Site Bar */}
              <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-cyan-950/60 border border-cyan-800/60 rounded-lg text-cyan-400">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-100 text-base">{site.name}</h3>
                      {site.code && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-cyan-300 border border-slate-700">
                          {site.code}
                        </span>
                      )}
                    </div>
                    {site.address && (
                      <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-500" />
                        {site.address}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                    {site._count?.devices || 0} Devices · {site._count?.cameras || 0} Cameras
                  </span>

                  <Button
                    variant="secondary"
                    onClick={() => openAddZoneModal(site)}
                    className="text-xs py-1 px-2.5 flex items-center gap-1 bg-slate-800 hover:bg-slate-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Zone
                  </Button>

                  <button
                    onClick={() => openEditSiteModal(site)}
                    className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
                    title="Edit Site"
                  >
                    <Edit className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setDeleteSiteTarget(site)}
                    className="p-1.5 hover:bg-rose-950/60 rounded text-slate-400 hover:text-rose-400 transition"
                    title="Delete Site"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Zones in this site */}
              <div className="p-4">
                {!site.zones || site.zones.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">
                    No physical zones defined for this site yet. Click "Add Zone" to specify floors or areas.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {site.zones.map((zone: any) => (
                      <div
                        key={zone.id}
                        className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg hover:border-slate-700 transition flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="text-xs font-semibold text-slate-200">{zone.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                            <span>Floor {zone.floor || 1}</span>
                            {zone.code && <span className="font-mono text-slate-500">[{zone.code}]</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEditZoneModal(site, zone)}
                            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
                            title="Edit Zone"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteZoneTarget(zone)}
                            className="p-1 hover:bg-rose-950/60 rounded text-slate-400 hover:text-rose-400 transition"
                            title="Delete Zone"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / Edit Site Modal */}
      <Modal
        isOpen={siteModalOpen}
        onClose={() => setSiteModalOpen(false)}
        title={editingSite ? 'Edit Site' : 'Add Physical Site / Branch'}
      >
        <form onSubmit={handleSiteSubmit} className="space-y-4 text-slate-200">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Site Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Headquarters, Factory Plant 1, Rayong Hub"
              value={siteForm.name}
              onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Site Code</label>
              <input
                type="text"
                placeholder="HQ-01, P1"
                value={siteForm.code}
                onChange={(e) => setSiteForm({ ...siteForm, code: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Address / Location</label>
              <input
                type="text"
                placeholder="Bangkok, Thailand"
                value={siteForm.address}
                onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
            <textarea
              rows={2}
              placeholder="Optional notes regarding this location"
              value={siteForm.description}
              onChange={(e) => setSiteForm({ ...siteForm, description: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <Button variant="secondary" onClick={() => setSiteModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createSiteMutation.isPending || updateSiteMutation.isPending}
              className="bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              {editingSite ? 'Save Changes' : 'Create Site'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add / Edit Zone Modal */}
      <Modal
        isOpen={zoneModalOpen}
        onClose={() => setZoneModalOpen(false)}
        title={editingZone ? `Edit Zone in ${zoneParentSite?.name}` : `Add Security Zone to ${zoneParentSite?.name}`}
      >
        <form onSubmit={handleZoneSubmit} className="space-y-4 text-slate-200">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Zone Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. 1F Lobby, Perimeter North, Server Room"
              value={zoneForm.name}
              onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Zone Code</label>
              <input
                type="text"
                placeholder="ZN-01"
                value={zoneForm.code}
                onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Floor Level</label>
              <input
                type="number"
                value={zoneForm.floor}
                onChange={(e) => setZoneForm({ ...zoneForm, floor: parseInt(e.target.value, 10) || 1 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Floor Plan Image URL (Optional)</label>
            <input
              type="text"
              placeholder="/maps/floor1.png"
              value={zoneForm.floorPlanImageUrl}
              onChange={(e) => setZoneForm({ ...zoneForm, floorPlanImageUrl: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <Button variant="secondary" onClick={() => setZoneModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createZoneMutation.isPending || updateZoneMutation.isPending}
              className="bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              {editingZone ? 'Save Changes' : 'Create Zone'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteSiteTarget || deleteZoneTarget)}
        onClose={() => { setDeleteSiteTarget(null); setDeleteZoneTarget(null); }}
        title="Confirm Delete"
      >
        <div className="space-y-4 text-slate-200">
          <p className="text-sm">
            Are you sure you want to delete{' '}
            <span className="font-bold text-cyan-400">
              {deleteSiteTarget?.name || deleteZoneTarget?.name}
            </span>
            ?
          </p>
          <div className="flex justify-end gap-3 pt-3">
            <Button variant="secondary" onClick={() => { setDeleteSiteTarget(null); setDeleteZoneTarget(null); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (deleteSiteTarget) deleteSiteMutation.mutate(deleteSiteTarget.id);
                if (deleteZoneTarget) deleteZoneMutation.mutate(deleteZoneTarget.id);
              }}
              className="bg-rose-600 hover:bg-rose-500 text-white"
            >
              Confirm Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
