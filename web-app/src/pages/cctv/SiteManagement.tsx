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
  AlertTriangle,
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LocationStatsRow } from '@/components/cctv/LocationStatsRow';
import { summarizeLocations } from '@/lib/locationSummary';
import { NO_LOCATION } from '@/lib/cameraFilter';
export default function SiteManagement() {
  const { t } = useTranslation()
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
      toast.success(t('ui.siteManagement.siteCreatedSuccessfully'));
      setSiteModalOpen(false);
      resetSiteForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.siteManagement.failedToCreateSite'));
    },
  });

  const updateSiteMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateSite(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success(t('ui.siteManagement.siteUpdated'));
      setSiteModalOpen(false);
      resetSiteForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.siteManagement.failedToUpdateSite'));
    },
  });

  const deleteSiteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteSite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success(t('ui.siteManagement.siteDeleted'));
      setDeleteSiteTarget(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.siteManagement.failedToDeleteSite'));
    },
  });

  // Zone Mutations
  const createZoneMutation = useMutation({
    mutationFn: (data: typeof zoneForm) => imageServiceApi.createZone(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success(t('ui.siteManagement.zoneAdded'));
      setZoneModalOpen(false);
      resetZoneForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.siteManagement.failedToAddZone'));
    },
  });

  const updateZoneMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => imageServiceApi.updateZone(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success(t('ui.siteManagement.zoneUpdated'));
      setZoneModalOpen(false);
      resetZoneForm();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.siteManagement.failedToUpdateZone'));
    },
  });

  const deleteZoneMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteZone(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-sites'] });
      toast.success(t('ui.siteManagement.zoneDeleted'));
      setDeleteZoneTarget(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || t('ui.siteManagement.failedToDeleteZone'));
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
  // Every camera, so the counts match the rest of the system: in use apart from switched off, and no trash.
  const { data: allCameras = [] } = useQuery<any[]>({
    queryKey: ['sites-page-cameras'],
    queryFn: () => imageServiceApi.getCameras(),
    refetchInterval: 15_000,
  });
  const { data: allDevices = [] } = useQuery<any[]>({
    queryKey: ['cctv-devices'],
    queryFn: () => imageServiceApi.getDevices(),
  });
  const summary = summarizeLocations(allCameras as any[], allDevices as any[]);
  const totalCamerasCount = summary.inUse;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase bg-cyan-950 text-cyan-400 border border-cyan-800">
              {t('ui.siteManagement.cctvPlatform')}
            </span>
            <span className="text-xs text-slate-400">{t('ui.siteManagement.phase1Foundation')}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 mt-1 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-cyan-400" />
            {t('ui.siteManagement.physicalHierarchySitesZones')}
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {t('ui.siteManagement.organizeBranchLocationsBuildingsFloorsAnd')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => refetch()} className="flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" />
            {t('ui.siteManagement.refresh')}
          </Button>
          <Button onClick={openAddSiteModal} className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white">
            <Plus className="w-4 h-4" />
            {t('ui.siteManagement.addSite')}
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">{t('ui.siteManagement.totalSitesBuildings')}</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">{sites.length}</p>
          </div>
          <div className="p-3 bg-cyan-950/70 border border-cyan-800/50 rounded-lg text-cyan-400">
            <Building2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">{t('ui.siteManagement.totalSecurityZones')}</p>
            <p className="text-2xl font-bold text-indigo-400 mt-1">{totalZonesCount}{' '}{t('ui.siteManagement.zones')}</p>
          </div>
          <div className="p-3 bg-indigo-950/70 border border-indigo-800/50 rounded-lg text-indigo-400">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400">{t('ui.siteManagement.camerasAssigned')}</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{totalCamerasCount}{' '}{t('ui.siteManagement.cams')}</p>
          </div>
          <div className="p-3 bg-emerald-950/70 border border-emerald-800/50 rounded-lg text-emerald-400">
            <Camera className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Search */}
      {(summary.noSite > 0 || summary.noZone > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 rounded-xl bg-amber-950/30 border border-amber-700/40 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="flex-1 min-w-[16rem]">{t('ui.location.unplacedNotice', { site: summary.noSite, zone: summary.noZone })}</span>
          <Link to={`/cctv/cameras?zone=${NO_LOCATION}&on=1`} className="px-2.5 py-1 rounded-md border border-amber-600/50 font-semibold hover:bg-amber-500/10">
            {t('ui.location.unplacedOpen')}
          </Link>
        </div>
      )}

      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder={t('ui.siteManagement.searchSitesByNameCodeAddress')}
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
            <p className="text-base font-semibold text-slate-300">{t('ui.siteManagement.noSitesOrLocationsConfigured')}</p>
            <p className="text-xs text-slate-500 mt-1">{t('ui.siteManagement.createYourFirstSiteToGroup')}</p>
            <Button onClick={openAddSiteModal} className="mt-4 bg-cyan-600 hover:bg-cyan-500 text-white text-xs">
              <Plus className="w-4 h-4 mr-1" />{' '}{t('ui.siteManagement.addSite')}
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
                    {summary.bySite.get(site.id)?.devices ?? 0}{' '}{t('ui.siteManagement.devices')}{' '}· {t('ui.location.statCameras', { n: summary.bySite.get(site.id)?.inUse ?? 0 })}
                  </span>

                  <Button
                    variant="secondary"
                    onClick={() => openAddZoneModal(site)}
                    className="text-xs py-1 px-2.5 flex items-center gap-1 bg-slate-800 hover:bg-slate-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('ui.siteManagement.addZone')}
                  </Button>

                  <button
                    onClick={() => openEditSiteModal(site)}
                    className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
                    title={t('ui.siteManagement.editSite')}
                  >
                    <Edit className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setDeleteSiteTarget(site)}
                    className="p-1.5 hover:bg-rose-950/60 rounded text-slate-400 hover:text-rose-400 transition"
                    title={t('ui.siteManagement.deleteSite')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Zones in this site */}
              <div className="p-4">
                <div className="mb-3 pb-3 border-b border-slate-800/60">
                  <LocationStatsRow stats={summary.bySite.get(site.id)} query={`site=${site.id}`} />
                  {(summary.noZoneBySite.get(site.id) ?? 0) > 0 && (
                    <Link to={`/cctv/cameras?site=${site.id}&zone=${NO_LOCATION}&on=1`} className="inline-block mt-2 text-[11px] text-amber-300 hover:text-amber-200">
                      {t('ui.location.noZoneInSite', { n: summary.noZoneBySite.get(site.id) })}
                    </Link>
                  )}
                </div>
                {!site.zones || site.zones.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-2">
                    {t('ui.siteManagement.noPhysicalZonesDefinedForThis')}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {site.zones.map((zone: any) => (
                      <div
                        key={zone.id}
                        data-zone-id={zone.id}
                      className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg hover:border-slate-700 transition space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="text-xs font-semibold text-slate-200">{zone.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                            <span>{t('ui.siteManagement.floor')}{' '}{zone.floor || 1}</span>
                            {zone.code && <span className="font-mono text-slate-500">[{zone.code}]</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEditZoneModal(site, zone)}
                            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
                            title={t('ui.siteManagement.editZone')}
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteZoneTarget(zone)}
                            className="p-1 hover:bg-rose-950/60 rounded text-slate-400 hover:text-rose-400 transition"
                            title={t('ui.siteManagement.deleteZone')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        </div>
                        <LocationStatsRow stats={summary.byZone.get(zone.id)} query={`site=${site.id}&zone=${zone.id}`} />
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
        title={editingSite ? t('ui.siteManagement.editSite') : t('ui.siteManagement.addPhysicalSiteBranch')}
      >
        <form onSubmit={handleSiteSubmit} className="space-y-4 text-slate-200">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.siteManagement.siteName')}</label>
            <input
              type="text"
              required
              placeholder={t('ui.siteManagement.eGHeadquartersFactoryPlant')}
              value={siteForm.name}
              onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.siteManagement.siteCode')}</label>
              <input
                type="text"
                placeholder={t('ui.siteManagement.hq01P')}
                value={siteForm.code}
                onChange={(e) => setSiteForm({ ...siteForm, code: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.siteManagement.addressLocation')}</label>
              <input
                type="text"
                placeholder={t('ui.siteManagement.bangkokThailand')}
                value={siteForm.address}
                onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.siteManagement.description')}</label>
            <textarea
              rows={2}
              placeholder={t('ui.siteManagement.optionalNotesRegardingThisLocation')}
              value={siteForm.description}
              onChange={(e) => setSiteForm({ ...siteForm, description: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <Button variant="secondary" onClick={() => setSiteModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={createSiteMutation.isPending || updateSiteMutation.isPending}
              className="bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              {editingSite ? t('ui.siteManagement.saveChanges') : t('ui.siteManagement.createSite')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add / Edit Zone Modal */}
      <Modal
        isOpen={zoneModalOpen}
        onClose={() => setZoneModalOpen(false)}
        title={editingZone ? t('ui.siteManagement.editZoneIn', { name: zoneParentSite?.name }) : t('ui.siteManagement.addSecurityZoneTo', { name: zoneParentSite?.name })}
      >
        <form onSubmit={handleZoneSubmit} className="space-y-4 text-slate-200">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.siteManagement.zoneName')}</label>
            <input
              type="text"
              required
              placeholder={t('ui.siteManagement.eG1fLobbyPerimeterNorth')}
              value={zoneForm.name}
              onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.siteManagement.zoneCode')}</label>
              <input
                type="text"
                placeholder={t('ui.siteManagement.zn')}
                value={zoneForm.code}
                onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.siteManagement.floorLevel')}</label>
              <input
                type="number"
                value={zoneForm.floor}
                onChange={(e) => setZoneForm({ ...zoneForm, floor: parseInt(e.target.value, 10) || 1 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">{t('ui.siteManagement.floorPlanImageUrlOptional')}</label>
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
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={createZoneMutation.isPending || updateZoneMutation.isPending}
              className="bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              {editingZone ? t('ui.siteManagement.saveChanges') : t('ui.siteManagement.createZone')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deleteSiteTarget || deleteZoneTarget)}
        onClose={() => { setDeleteSiteTarget(null); setDeleteZoneTarget(null); }}
        title={t('common.deleteConfirm')}
      >
        <div className="space-y-4 text-slate-200">
          <p className="text-sm">
            {t('ui.siteManagement.areYouSureYouWantTo')}{' '}
            <span className="font-bold text-cyan-400">
              {deleteSiteTarget?.name || deleteZoneTarget?.name}
            </span>
            ?
          </p>
          <div className="flex justify-end gap-3 pt-3">
            <Button variant="secondary" onClick={() => { setDeleteSiteTarget(null); setDeleteZoneTarget(null); }}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (deleteSiteTarget) deleteSiteMutation.mutate(deleteSiteTarget.id);
                if (deleteZoneTarget) deleteZoneMutation.mutate(deleteZoneTarget.id);
              }}
              className="bg-rose-600 hover:bg-rose-500 text-white"
            >
              {t('common.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
