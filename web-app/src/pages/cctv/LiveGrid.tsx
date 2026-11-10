import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCameraFavorites } from '@/hooks/useCameraFavorites';
import { CameraQuickActions } from '@/components/cctv/CameraQuickActions';
import { useTheme } from '@/contexts/ThemeContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { LiveHdPlayer } from '@/components/cctv/LiveHdPlayer';
import { CameraFilterDropdown } from '@/components/cctv/CameraFilterDropdown';
import { LiveOverview } from '@/components/cctv/LiveOverview';
import { LiveViewsModal, useLiveViews, type LiveView } from '@/components/cctv/LiveViewsModal';
import { hasPermission } from '@/App';
import { applyCameraSelection, applyLocationFilter, camerasForEmptySlots, favoritesFirst, NO_LOCATION } from '@/lib/cameraFilter';
import { SearchableSelect } from '@/components/ui';
import {
  Grid2X2,
  Square,
  Grid3X3,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Camera,
  RefreshCw,
  Plus,
  X,
  Search,
  HardDrive,
  Building2,
  Radio,
  Bookmark,
  
  
  Check,
  Layers,
  Play,
  Pause,
  SkipForward,
  GripVertical,
  SkipBack,
  Clock,
  ChevronRight,
  ChevronDown,
  Activity,
  AlertCircle,
  Eye,
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { useCctvCameras } from '@/hooks/useCctvCameras';
type GridLayout = '1x1' | '2x2' | '3x3' | '4x4';

interface GridCell {
  slotIndex: number;
  cameraId: string | null;
  cameraName: string | null;
  streamUrl: string | null;
  streamProfile: 'main' | 'sub';
  /** The camera whose main stream this browser could not open, so this slot uses the sub stream. */
  mainFailedFor?: string | null;
  hasSubStream: boolean;
}


const FILTER_STORAGE_KEY = 'cctv_live_filter';
const VIEW_STORAGE_KEY = 'cctv_live_view';
const LAYOUT_STORAGE_KEY = 'cctv_live_layout';
const LOCATION_STORAGE_KEY = 'cctv_live_location';
/** A tab hidden this long stops its streams (a quick look elsewhere does not); they reopen when it is shown again. */
export const HIDDEN_PAUSE_MS = 20_000;
// Past this many cameras the page opens on the overview instead of a few tiles.
const OVERVIEW_DEFAULT_ABOVE = 16;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience: the choice still applies for this visit.
  }
}

function readSavedFilter(): { ids: string[]; onlyOffline: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? '{}');
    return { ids: Array.isArray(saved.ids) ? saved.ids : [], onlyOffline: saved.onlyOffline === true };
  } catch {
    return { ids: [], onlyOffline: false };
  }
}


function CameraOfflineBanner() {
  const { t } = useTranslation();
  return (
    <div data-camera-offline className="absolute top-10 left-2 right-2 z-30 px-2 py-1 rounded bg-rose-950/90 border border-rose-700 text-[11px] font-semibold text-rose-100 pointer-events-none">
      {t('ui.liveGrid.cameraOfflineBanner')}
    </div>
  );
}

/** Stands in for a player while the tab has been hidden for a while; the stream reopens when the tab is shown. */
function PausedHidden({ name }: { name?: string | null }) {
  const { t } = useTranslation();
  return (
    <div data-paused-hidden className="w-full h-full flex flex-col items-center justify-center gap-1 bg-black px-3 text-center">
      {name && <span className="text-xs font-semibold text-slate-300">{name}</span>}
      <span className="text-[11px] text-slate-500">{t('ui.liveGrid.pausedHidden')}</span>
    </div>
  );
}

export default function LiveGrid() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  // Each person's last view, in this browser.
  const { user } = useAuth();
  const userKey = (user as any)?.id ?? (user as any)?.username ?? 'anon';
  const viewKey = `${VIEW_STORAGE_KEY}:${userKey}`;
  const layoutKey = `${LAYOUT_STORAGE_KEY}:${userKey}`;
  const [layout, setLayout] = useState<GridLayout>(() => {
    const saved = readStored(layoutKey);
    return saved === '1x1' || saved === '2x2' || saved === '3x3' || saved === '4x4' ? saved : '2x2';
  });
  const [activeSlot, setActiveSlot] = useState<number>(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cameraSearch, setCameraSearch] = useState('');
  const [selectedSiteFilter, setSelectedSiteFilter] = useState<string>('all');
  const [cameraFilter, setCameraFilter] = useState(readSavedFilter);
  const locationKey = `${LOCATION_STORAGE_KEY}:${userKey}`;
  const [urlParams, setUrlParams] = useSearchParams();
  const [locationFilter, setLocationFilter] = useState<{ sites: string[]; zones: string[] }>(() => {
    // A link from a place decides; it also becomes the remembered choice.
    const linkedSite = urlParams.get('site');
    const linkedZone = urlParams.get('zone');
    if (linkedSite || linkedZone) {
      const linked = { sites: linkedSite ? [linkedSite] : [], zones: linkedZone ? [linkedZone] : [] };
      store(locationKey, JSON.stringify(linked));
      return linked;
    }
    try {
      const saved = JSON.parse(readStored(locationKey) ?? '{}');
      return { sites: Array.isArray(saved.sites) ? saved.sites : [], zones: Array.isArray(saved.zones) ? saved.zones : [] };
    } catch {
      return { sites: [], zones: [] };
    }
  });
  useEffect(() => {
    if (urlParams.get('site') || urlParams.get('zone')) setUrlParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chooseLocation = (next: { sites: string[]; zones: string[] }) => {
    setLocationFilter(next);
    store(locationKey, JSON.stringify(next));
  };
  const [savedView, setSavedView] = useState<'overview' | 'grid' | null>(() => {
    const saved = readStored(viewKey);
    return saved === 'overview' || saved === 'grid' ? saved : null;
  });
  const [isWallFullscreen, setIsWallFullscreen] = useState(false);

  // Nobody looking: after a while hidden, the wall drops its streams so recorders are not pulled for nothing.
  const [pausedHidden, setPausedHidden] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.hidden) timer = setTimeout(() => setPausedHidden(true), HIDDEN_PAUSE_MS);
      else setPausedHidden(false);
    };
    document.addEventListener('visibilitychange', onChange);
    return () => { document.removeEventListener('visibilitychange', onChange); if (timer) clearTimeout(timer); };
  }, []);

  // Auto-Tour / Patrol Mode state for hundreds of cameras
  const [isTourActive, setIsTourActive] = useState<boolean>(false);
  const [tourIntervalSeconds, setTourIntervalSeconds] = useState<number>(15);
  const [tourCountdown, setTourCountdown] = useState<number>(15);
  const [tourPageIndex, setTourPageIndex] = useState<number>(0);

  // Accordion state in camera drawer
  const [expandedSites, setExpandedSites] = useState<Record<string, boolean>>({});
  const [expandedZones, setExpandedZones] = useState<Record<string, boolean>>({});

  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const { data: liveViews = [] } = useLiveViews();
  const canShareViews = hasPermission(user, 'cameras:update');

  // Layout slots count
  const getSlotCount = (l: GridLayout): number => {
    switch (l) {
      case '1x1': return 1;
      case '2x2': return 4;
      case '3x3': return 9;
      case '4x4': return 16;
    }
  };

  const slotCount = getSlotCount(layout);

  // Cells state
  const [cells, setCells] = useState<GridCell[]>(() =>
    Array.from({ length: 16 }, (_, i) => ({
      slotIndex: i,
      cameraId: null,
      cameraName: null,
      streamUrl: null,
      streamProfile: 'main',
      hasSubStream: false,
    }))
  );

  // Queries
  const { data: cameras = [], isLoading: isLoadingCameras } = useCctvCameras();
  const isOverview = (savedView ?? (cameras.length > OVERVIEW_DEFAULT_ABOVE ? 'overview' : 'grid')) === 'overview';
  const chooseView = (view: 'overview' | 'grid') => {
    setSavedView(view);
    store(viewKey, view);
  };
  // HD by itself per layout (System Config, admin); a single camera is always HD.
  const { data: liveSettings } = useQuery<any>({ queryKey: ['snapshot-settings'], queryFn: () => imageServiceApi.getSnapshotSettings(), staleTime: 60_000 });
  const autoHd: Record<string, boolean> = liveSettings?.autoHd ?? { '1x1': true, '2x2': true, '3x3': false, '4x4': false };
  const autoProfile = (l: GridLayout): 'main' | 'sub' => (l === '1x1' || autoHd[l] ? 'main' : 'sub');
  // The first fill has happened (or was overtaken by a choice), so an empty slot is now the person's choice.
  const filledOnce = useRef(false);
  const fillLayout = (next: GridLayout) => {
    filledOnce.current = true;
    const count = getSlotCount(next);
    const profile = autoProfile(next);
    const kept = cells.slice(0, count);
    const toFill = camerasForEmptySlots(filteredCameras, kept.map((c) => c.cameraId));
    let nextToFill = 0;
    kept.forEach((cell) => {
      if (cell.cameraId) {
        if (cell.streamProfile !== profile) {
          const cam = cameras.find((c: any) => c.id === cell.cameraId);
          if (cam) assignCameraToSlot(cam, cell.slotIndex, profile, true);
        }
      } else if (nextToFill < toFill.length) {
        assignCameraToSlot(toFill[nextToFill++], cell.slotIndex, profile, true);
      }
    });
    // Slots this layout does not show stop streaming.
    setCells((prev) => prev.map((c) => (c.slotIndex >= count ? { ...c, cameraId: null, cameraName: null, streamUrl: null, streamProfile: 'main', hasSubStream: false } : c)));
    setTourPageIndex(0);
    setTourCountdown(tourIntervalSeconds);
    setActiveSlot((slot) => (slot < count ? slot : 0));
  };
  const chooseLayout = (next: GridLayout) => {
    setLayout(next);
    store(layoutKey, next);
    chooseView('grid');
    fillLayout(next);
  };

  const { favorites, isLoading: isLoadingFavorites, toggleFavorite } = useCameraFavorites();

  // Double click: one camera at full size in its best quality. The tiles behind it stop streaming meanwhile.
  const [focus, setFocus] = useState<{ cameraId: string; name: string; streamUrl: string; profile: 'main' | 'sub'; hasSub: boolean; fellBack: boolean } | null>(null);
  const openFocus = async (cam: any, preferred: 'main' | 'sub' = 'main', fellBack = false) => {
    try {
      const stream = await imageServiceApi.getCameraStream(cam.id, { profile: preferred });
      setFocus({ cameraId: cam.id, name: cam.name, streamUrl: stream.webrtcWhepUrl, profile: stream.profile || preferred, hasSub: Boolean(stream.hasSubStream), fellBack });
    } catch {
      setFocus(null);
    }
  };
  // A link to one camera (?focus=<id>, e.g. from the availability page) opens it full screen, as a double-click does.
  // Read once on arrival: the site/zone link handling above clears the address.
  const focusFromLink = useRef(urlParams.get('focus'));
  useEffect(() => {
    const id = focusFromLink.current;
    if (!id || cameras.length === 0) return;
    focusFromLink.current = null;
    const cam = cameras.find((c: any) => c.id === id);
    if (cam) void openFocus(cam);
    if (urlParams.get('focus')) {
      const next = new URLSearchParams(urlParams);
      next.delete('focus');
      setUrlParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras]);
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocus(null);
      // Left/right step the full view through the cameras, as the patrol buttons do.
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        stepFocusRef.current(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const { data: devices = [] } = useQuery({
    queryKey: ['cctv-devices'],
    queryFn: () => imageServiceApi.getDevices(),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['cctv-sites'],
    queryFn: () => imageServiceApi.getSites(),
  });

  // Assign camera to current slot with preferred profile
  const assignCameraToSlot = useCallback(
    async (cam: any, slotIdx: number, preferredProfile?: 'main' | 'sub', automatic = !preferredProfile) => {
      // The wall's own rule (System Config: HD by itself per layout) unless a person picked SD/HD for this tile.
      const profileToUse = preferredProfile || autoProfile(layout);

      try {
        const streamData = await imageServiceApi.getCameraStream(cam.id, {
          profile: profileToUse,
          ...(automatic && profileToUse === 'main' ? { auto: 1 as const } : {}),
        });

        const fallbackWhep = `/mediamtx/webrtc/${
          profileToUse === 'sub' && cam.rtspUrlSub
            ? `${cam.streamPath || `camera_${cam.id.replace(/-/g, '').substring(0, 12)}`}_sub`
            : cam.streamPath || `camera_${cam.id.replace(/-/g, '').substring(0, 12)}`
        }/whep`;

        const streamUrl = streamData.webrtcWhepUrl || fallbackWhep;

        setCells((prev) =>
          prev.map((c) =>
            c.slotIndex === slotIdx
              ? {
                  ...c,
                  cameraId: cam.id,
                  cameraName: cam.name,
                  streamUrl,
                  streamProfile: streamData.profile || profileToUse,
                  hasSubStream: Boolean(streamData.hasSubStream || cam.rtspUrlSub),
                }
              : c
          )
        );
      } catch {
        const streamPath = cam.streamPath || `camera_${cam.id.replace(/-/g, '').substring(0, 12)}`;
        setCells((prev) =>
          prev.map((c) =>
            c.slotIndex === slotIdx
              ? {
                  ...c,
                  cameraId: cam.id,
                  cameraName: cam.name,
                  streamUrl: `/mediamtx/webrtc/${streamPath}/whep`,
                  streamProfile: 'main',
                  hasSubStream: false,
                }
              : c
          )
        );
      }
    },
    // layout and the HD setting decide the profile, so a stale copy would open the wrong stream.
    [slotCount, layout, liveSettings]
  );

  // Toggle profile between main and sub for a cell
  const handleToggleCellProfile = async (slotIdx: number, nextProfile: 'main' | 'sub') => {
    const cell = cells.find((c) => c.slotIndex === slotIdx);
    if (!cell || !cell.cameraId) return;

    const cam = cameras.find((c: any) => c.id === cell.cameraId);
    if (cam) {
      await assignCameraToSlot(cam, slotIdx, nextProfile);
    }
  };

  // Often H.265, which not every browser can play: the sub stream keeps the picture on screen.
  const handleStreamFailed = async (slotIdx: number) => {
    const cell = cells.find((c) => c.slotIndex === slotIdx);
    if (!cell?.cameraId || cell.streamProfile !== 'main' || !cell.hasSubStream) return;
    const cam = cameras.find((c: any) => c.id === cell.cameraId);
    if (!cam) return;
    const failedCamera = cell.cameraId;
    await assignCameraToSlot(cam, slotIdx, 'sub');
    setCells((prev) => prev.map((c) => (c.slotIndex === slotIdx ? { ...c, mainFailedFor: failedCamera } : c)));
  };

  // Drag and drop on the wall: a camera from the list into a slot (fills or replaces it), or one slot onto another
  // (the two swap). Slots are dragged by their grip, so double-click and zoom/pan inside the picture stay as they were.
  const DRAG_CAMERA = 'application/x-cctv-camera';
  const DRAG_SLOT = 'application/x-cctv-slot';
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const startDrag = (e: React.DragEvent, type: string, value: string) => {
    e.dataTransfer.setData(type, value);
    e.dataTransfer.effectAllowed = type === DRAG_SLOT ? 'move' : 'copy';
    // A patrol running on would page the wall under the drop.
    if (isTourActive) setIsTourActive(false);
  };
  const acceptsDrop = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_CAMERA) || e.dataTransfer.types.includes(DRAG_SLOT);
  const dropOnSlot = (e: React.DragEvent, slotIdx: number) => {
    setDragOverSlot(null);
    const cameraId = e.dataTransfer.getData(DRAG_CAMERA);
    const fromSlot = e.dataTransfer.getData(DRAG_SLOT);
    if (!cameraId && fromSlot === '') return;
    e.preventDefault();
    setActiveSlot(slotIdx);
    if (cameraId) {
      const cam = cameras.find((c: any) => c.id === cameraId);
      if (cam) void assignCameraToSlot(cam, slotIdx);
      return;
    }
    const from = Number(fromSlot);
    if (!Number.isInteger(from) || from === slotIdx) return;
    const moving = ['cameraId', 'cameraName', 'streamUrl', 'streamProfile', 'hasSubStream', 'mainFailedFor'] as const;
    setCells((prev) => {
      const a = prev.find((c) => c.slotIndex === from);
      const b = prev.find((c) => c.slotIndex === slotIdx);
      if (!a || !b) return prev;
      const pick = (c: any) => Object.fromEntries(moving.map((k) => [k, c[k]]));
      return prev.map((c) => (c.slotIndex === from ? { ...c, ...pick(b) } : c.slotIndex === slotIdx ? { ...c, ...pick(a) } : c));
    });
  };

  // A camera picked in the panel goes into the selected slot, and the panel stays open on the next empty slot, so a
  // wall fills by clicking camera after camera. With every slot taken it moves on in turn; one slot just closes.
  const pickIntoSlot = (cam: any) => {
    const slot = activeSlot;
    void assignCameraToSlot(cam, slot);
    if (slotCount <= 1) {
      setDrawerOpen(false);
      return;
    }
    const after = Array.from({ length: slotCount - 1 }, (_, k) => (slot + 1 + k) % slotCount);
    const empty = after.find((i) => !cells.find((c) => c.slotIndex === i)?.cameraId);
    setActiveSlot(empty ?? (slot + 1) % slotCount);
  };

  const clearSlot = (slotIdx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setCells((prev) =>
      prev.map((c) =>
        c.slotIndex === slotIdx
          ? {
              ...c,
              cameraId: null,
              cameraName: null,
              streamUrl: null,
              streamProfile: 'main',
              hasSubStream: false,
            }
          : c
      )
    );
  };

  // Filter cameras. The drawer lists every camera so one outside the filter can still be placed by hand.
  const drawerCameras = cameras.filter((c: any) => {
    const matchesSearch =
      c.name.toLowerCase().includes(cameraSearch.toLowerCase()) ||
      c.ipAddress?.toLowerCase().includes(cameraSearch.toLowerCase());
    const matchesSite =
      selectedSiteFilter === 'all' || c.siteId === selectedSiteFilter;
    return matchesSearch && matchesSite;
  });
  const filteredCameras = favoritesFirst(
    applyCameraSelection(applyLocationFilter(drawerCameras, locationFilter.sites, locationFilter.zones), cameraFilter.ids, cameraFilter.onlyOffline),
    favorites,
  );
  const siteOptions = [{ value: NO_LOCATION, label: t('ui.location.none') }, ...(sites as any[]).map((site) => ({ value: site.id, label: site.name }))];
  // The zones of the chosen sites; with no site chosen, every zone says which site it is in.
  const zoneOptions = [
    { value: NO_LOCATION, label: t('ui.location.none') },
    ...(sites as any[])
      .filter((site) => locationFilter.sites.length === 0 || locationFilter.sites.includes(site.id))
      .flatMap((site) => (site.zones ?? []).map((zone: any) => ({ value: zone.id, label: locationFilter.sites.length === 1 ? zone.name : `${zone.name} (${site.code || site.name})` }))),
  ];

  // With one camera full screen, the patrol and its next/previous step through the cameras in that view, one at a
  // time, instead of paging the wall hidden behind it.
  const focusPosition = focus ? filteredCameras.findIndex((c: any) => c.id === focus.cameraId) : -1;
  const stepFocus = (dir: 1 | -1) => {
    const list = filteredCameras.length > 0 ? filteredCameras : cameras;
    if (!focus || list.length === 0) return;
    const at = list.findIndex((c: any) => c.id === focus.cameraId);
    const next = list[at < 0 ? 0 : (at + dir + list.length) % list.length];
    if (next && next.id !== focus.cameraId) void openFocus(next);
  };
  const stepFocusRef = useRef(stepFocus);
  stepFocusRef.current = stepFocus;
  const focusing = !!focus;

  // Calculate tour pages for hundreds of cameras
  const totalTourPages = Math.max(1, Math.ceil(filteredCameras.length / slotCount));

  // Load a batch page of cameras into slots
  const loadTourPage = useCallback(
    (page: number) => {
      const startIdx = page * slotCount;
      const pageCams = filteredCameras.slice(startIdx, startIdx + slotCount);

      for (let i = 0; i < slotCount; i++) {
        if (i < pageCams.length) {
          assignCameraToSlot(pageCams[i], i);
        } else {
          // Clear unused slots on the last page
          setCells((prev) =>
            prev.map((c) =>
              c.slotIndex === i
                ? {
                    ...c,
                    cameraId: null,
                    cameraName: null,
                    streamUrl: null,
                    streamProfile: 'main',
                    hasSubStream: false,
                  }
                : c
            )
          );
        }
      }
    },
    [filteredCameras, slotCount, assignCameraToSlot]
  );

  // A changed filter restarts paging at its first page. It keys on the filter itself: the camera list
  // refreshes every 10 s and that must not reload the streams on screen.
  const filterKey = JSON.stringify(cameraFilter) + JSON.stringify(locationFilter);
  const appliedFilterKey = useRef(filterKey);
  useEffect(() => {
    if (appliedFilterKey.current === filterKey) return;
    appliedFilterKey.current = filterKey;
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(cameraFilter));
    } catch {
      // Only a convenience: the filter still applies for this visit.
    }
    setTourPageIndex(0);
    setTourCountdown(tourIntervalSeconds);
    if (!isOverview) loadTourPage(0);
  }, [filterKey, loadTourPage, tourIntervalSeconds, isOverview]);

  // Tour Mode countdown & auto-advance timer
  useEffect(() => {
    if (!isTourActive || pausedHidden) return;
    if (!focusing && (isOverview || filteredCameras.length <= slotCount)) return;

    const interval = setInterval(() => {
      setTourCountdown((prev) => {
        if (prev <= 1 && focusing) {
          stepFocusRef.current(1);
          return tourIntervalSeconds;
        }
        if (prev <= 1) {
          // Advance to next page
          setTourPageIndex((currentPage) => {
            const nextPage = (currentPage + 1) % totalTourPages;
            loadTourPage(nextPage);
            return nextPage;
          });
          return tourIntervalSeconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOverview, isTourActive, tourIntervalSeconds, totalTourPages, slotCount, filteredCameras.length, loadTourPage, focusing, pausedHidden]);

  // Handle manual next/prev tour page
  const handleNextTourPage = () => {
    if (focus) {
      setTourCountdown(tourIntervalSeconds);
      stepFocus(1);
      return;
    }
    const nextPage = (tourPageIndex + 1) % totalTourPages;
    setTourPageIndex(nextPage);
    setTourCountdown(tourIntervalSeconds);
    loadTourPage(nextPage);
  };

  const handlePrevTourPage = () => {
    if (focus) {
      setTourCountdown(tourIntervalSeconds);
      stepFocus(-1);
      return;
    }
    const prevPage = (tourPageIndex - 1 + totalTourPages) % totalTourPages;
    setTourPageIndex(prevPage);
    setTourCountdown(tourIntervalSeconds);
    loadTourPage(prevPage);
  };

  // 1-Click: Display entire Zone or NVR in current wall
  const handleDisplayGroupInGrid = (groupCams: any[]) => {
    const targetCount = Math.min(groupCams.length, slotCount);
    for (let i = 0; i < slotCount; i++) {
      if (i < targetCount) {
        assignCameraToSlot(groupCams[i], i);
      } else {
        setCells((prev) =>
          prev.map((c) =>
            c.slotIndex === i
              ? {
                  ...c,
                  cameraId: null,
                  cameraName: null,
                  streamUrl: null,
                  streamProfile: 'main',
                  hasSubStream: false,
                }
              : c
          )
        );
      }
    }
    setDrawerOpen(false);
  };

  const autoHdKey = autoHd[layout] ? 'hd' : 'sd';
  const appliedAutoHd = useRef(autoHdKey);
  useEffect(() => {
    if (appliedAutoHd.current === autoHdKey) return;
    appliedAutoHd.current = autoHdKey;
    if (!isOverview && filledOnce.current) fillLayout(layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoHdKey]);

  // Saved views (server): load replaces the wall with the view's cameras that this person may see.
  const handleLoadPreset = (view: LiveView) => {
    filledOnce.current = true;
    // A view is a wall of slots; on the overview it would load out of sight.
    chooseView('grid');
    setLayout(view.layout);

    const newCells: GridCell[] = Array.from({ length: 16 }, (_, i) => ({
      slotIndex: i,
      cameraId: null,
      cameraName: null,
      streamUrl: null,
      streamProfile: 'main',
      hasSubStream: false,
    }));
    setCells(newCells);

    view.slots.forEach((s) => {
      const cam = cameras.find((c: any) => c.id === s.cameraId);
      if (cam) {
        assignCameraToSlot(cam, s.slotIndex);
      }
    });
  };

  // Fullscreen wall
  const handleToggleWallFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current
        .requestFullscreen()
        .then(() => setIsWallFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsWallFullscreen(false))
        .catch(() => {});
    }
  };

  // Initial fill if slots empty
  useEffect(() => {
    // Waits for the stars, so starred cameras get the first slots.
    if (filledOnce.current || isOverview || isLoadingFavorites || cameras.length === 0) return;
    fillLayout(layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, isOverview, isLoadingFavorites]);

  // Online / offline stats
  const onlineCount = cameras.filter((c: any) => c.operationalStatus === 'online').length;
  const offlineCount = cameras.filter((c: any) => c.operationalStatus === 'offline').length;

  return (
    <div
      ref={containerRef}
      className="h-[calc(100vh-60px)] flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none"
    >
      {/* Top Toolbar */}
      <div className="h-14 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
            <h1 className="text-base font-bold tracking-tight text-slate-100">{t('ui.liveGrid.cctvLiveWall')}</h1>
          </div>

          {/* Camera Scale Metrics */}
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
            <span className="text-slate-400">{t('ui.liveGrid.total')}</span>
            <span className="font-bold text-slate-200">{cameras.length}</span>
            <span className="text-slate-600">|</span>
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {onlineCount}{' '}{t('ui.liveGrid.online')}
            </span>
            {offlineCount > 0 && (
              <>
                <span className="text-slate-600">|</span>
                <span className="text-rose-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                  {offlineCount}{' '}{t('ui.liveGrid.offline')}
                </span>
              </>
            )}
          </div>

          <div className="w-36" title={t('ui.location.site')}>
            <SearchableSelect
              isMulti
              selectedValues={locationFilter.sites}
              placeholder={t('ui.location.allSites')}
              countLabel={(n) => t('ui.location.sitesChosen', { n })}
              options={siteOptions}
              onMultiChange={(next) => {
                // A zone of a site no longer chosen would hide everything.
                const allowed = new Set((sites as any[]).filter((x) => next.length === 0 || next.includes(x.id)).flatMap((x) => (x.zones ?? []).map((z: any) => z.id)));
                chooseLocation({ sites: next, zones: locationFilter.zones.filter((z) => z === NO_LOCATION || allowed.has(z)) });
              }}
            />
          </div>
          <div className="w-36" title={t('ui.location.zone')}>
            <SearchableSelect
              isMulti
              selectedValues={locationFilter.zones}
              placeholder={t('ui.location.allZones')}
              countLabel={(n) => t('ui.location.zonesChosen', { n })}
              options={zoneOptions}
              onMultiChange={(next) => chooseLocation({ ...locationFilter, zones: next })}
            />
          </div>

          <CameraFilterDropdown
            cameras={applyLocationFilter(cameras, locationFilter.sites, locationFilter.zones)}
            selectedIds={cameraFilter.ids}
            onlyOffline={cameraFilter.onlyOffline}
            onApply={(ids, onlyOffline) => setCameraFilter({ ids, onlyOffline })}
          />
        </div>

        {/* Center: Auto-Tour / Patrol Controls (For Hundreds of Cameras) */}
        {((!isOverview && filteredCameras.length > slotCount) || (focusing && filteredCameras.length > 1)) && (
          <div className="hidden md:flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
            <button
              onClick={() => {
                const nextState = !isTourActive;
                setIsTourActive(nextState);
                if (nextState) setTourCountdown(tourIntervalSeconds);
              }}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold transition ${
                isTourActive
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 animate-pulse'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
              title={isTourActive ? t('ui.liveGrid.pauseAutoTour') : t('ui.liveGrid.startAutoTourSequence')}
            >
              {isTourActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{t('ui.liveGrid.tour')}{' '}{isTourActive ? `(${tourCountdown}s)` : t('ui.liveGrid.patrol')}</span>
            </button>

            <button
              onClick={handlePrevTourPage}
              className="p-1 text-slate-400 hover:text-slate-200 rounded"
              title={t('ui.liveGrid.previousCameraPage')}
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>

            <span className="text-[11px] font-mono text-cyan-400 px-1">
              {focusing ? `${focusPosition + 1}/${filteredCameras.length}` : `${tourPageIndex + 1}/${totalTourPages}`}
            </span>

            <button
              onClick={handleNextTourPage}
              className="p-1 text-slate-400 hover:text-slate-200 rounded"
              title={t('ui.liveGrid.nextCameraPage')}
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>

            {/* Tour Interval Selector */}
            <select
              value={tourIntervalSeconds}
              onChange={(e) => {
                const val = Number(e.target.value);
                setTourIntervalSeconds(val);
                setTourCountdown(val);
              }}
              className="bg-slate-900 border border-slate-800 text-[10px] text-slate-400 rounded px-1.5 py-0.5 focus:outline-none"
              title={t('ui.liveGrid.tourCycleInterval')}
            >
              <option value={10}>10s</option>
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </div>
        )}

        {/* Right Toolbar: Layout Selectors & Action Buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Grid Selectors */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => chooseView('overview')}
              className={`px-2 py-1 rounded text-xs font-medium transition ${
                isOverview ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('ui.liveGrid.overview.viewHint')}
            >
              {t('ui.liveGrid.overview.view')}
            </button>
            <button
              onClick={() => chooseLayout('1x1')}
              className={`p-1.5 rounded transition ${
                !isOverview && layout === '1x1' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={`${t('ui.liveGrid.n1x1SingleCamera')} — HD`}
            >
              <Square className="w-4 h-4" />
            </button>
            <button
              onClick={() => chooseLayout('2x2')}
              className={`p-1.5 rounded transition ${
                !isOverview && layout === '2x2' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={`${t('ui.liveGrid.n2x24Cameras')} — ${autoHd['2x2'] ? 'HD' : 'SD'}`}
            >
              <Grid2X2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => chooseLayout('3x3')}
              className={`p-1.5 rounded transition ${
                !isOverview && layout === '3x3' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={`${t('ui.liveGrid.n3x39CamerasAutoSubStream')} — ${autoHd['3x3'] ? 'HD' : 'SD'}`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => chooseLayout('4x4')}
              className={`p-1.5 rounded transition ${
                !isOverview && layout === '4x4' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={`${t('ui.liveGrid.n4x416CamerasAutoSubStream')} — ${autoHd['4x4'] ? 'HD' : 'SD'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>

          <div className="h-6 w-px bg-slate-800 mx-1" />

          {/* Preset Manager Button */}
          <button
            onClick={() => setPresetModalOpen(true)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5 transition"
            title={t('ui.liveGrid.managePresets')}
          >
            <Bookmark className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">{t('ui.liveGrid.presets')}</span>
            {liveViews.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 text-[10px] flex items-center justify-center font-mono">
                {liveViews.length}
              </span>
            )}
          </button>

          {/* Toggle Camera Drawer */}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition ${
              drawerOpen
                ? 'bg-cyan-600 text-white border-cyan-500'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>{t('ui.liveGrid.selectCameras')}</span>
          </button>

          {/* Fullscreen Video Wall */}
          <button
            onClick={handleToggleWallFullscreen}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
            title={isWallFullscreen ? t('ui.liveGrid.exitFullscreenWall') : t('ui.liveGrid.fullscreenVideoWall')}
          >
            {isWallFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Main Grid Viewport */}
      <div className="flex-1 flex overflow-hidden relative">
        {focus && (
          <div
            className="flex-1 min-h-0 relative bg-black"
            onDoubleClick={(e) => {
              if (!(e.target as HTMLElement).closest('button, a')) setFocus(null);
            }}
          >
            {cameras.find((c: any) => c.id === focus.cameraId)?.operationalStatus === 'offline' && <CameraOfflineBanner />}
            {pausedHidden ? <PausedHidden name={focus.name} /> : <LiveHdPlayer
              cameraId={focus.cameraId}
              key={focus.streamUrl}
              streamUrl={focus.streamUrl}
              cameraName={focus.name}
              streamProfile={focus.profile}
              hasSubStream={focus.hasSub}
              onToggleProfile={(next) => {
                const cam = cameras.find((c: any) => c.id === focus.cameraId);
                if (cam) openFocus(cam, next);
              }}
              onFatalError={() => {
                const cam = cameras.find((c: any) => c.id === focus.cameraId);
                if (cam && focus.profile === 'main' && focus.hasSub) openFocus(cam, 'sub', true);
              }}
              className="w-full h-full"
            />}
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-700 text-[11px] text-slate-300">
              <span className="pointer-events-none">{focus.fellBack ? t('ui.liveGrid.mainStreamFellBack') : t('ui.liveGrid.focusHint')}</span>
              <CameraQuickActions cameraId={focus.cameraId} deviceId={cameras.find((c: any) => c.id === focus.cameraId)?.deviceId} isFavorite={favorites.has(focus.cameraId)} onToggleFavorite={toggleFavorite} />
              <button type="button" onClick={() => setFocus(null)} title={t('ui.liveGrid.focusClose')} aria-label={t('ui.liveGrid.focusClose')} className="p-0.5 rounded hover:bg-slate-800 text-slate-200">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        {isOverview ? (
          <div className={focus ? 'hidden' : 'contents'}><LiveOverview
            onFocusCamera={(cam: any) => openFocus(cam)} cameras={filteredCameras} /></div>
        ) : (
        <div className={`flex-1 p-2 overflow-auto flex items-center justify-center ${focus ? 'hidden' : ''}`}>
          <div
            className={`w-full h-full max-h-full grid gap-2 ${
              layout === '1x1'
                ? 'grid-cols-1'
                : layout === '2x2'
                ? 'grid-cols-2 grid-rows-2'
                : layout === '3x3'
                ? 'grid-cols-3 grid-rows-3'
                : 'grid-cols-4 grid-rows-4'
            }`}
          >
            {cells.slice(0, slotCount).map((cell) => {
              const isSelected = activeSlot === cell.slotIndex;

              return (
                <div
                  key={cell.slotIndex}
                  onClick={() => setActiveSlot(cell.slotIndex)}
                  onDoubleClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, a')) return;
                    const cam = cameras.find((c: any) => c.id === cell.cameraId);
                    if (cam) openFocus(cam);
                  }}
                  data-grid-slot={cell.slotIndex}
                  onDragOver={(e) => {
                    if (!acceptsDrop(e)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_SLOT) ? 'move' : 'copy';
                    if (dragOverSlot !== cell.slotIndex) setDragOverSlot(cell.slotIndex);
                  }}
                  onDragLeave={(e) => {
                    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOverSlot((s) => (s === cell.slotIndex ? null : s));
                  }}
                  onDrop={(e) => dropOnSlot(e, cell.slotIndex)}
                  className={`relative rounded-lg overflow-hidden bg-slate-900 border-2 transition cursor-pointer group ${dragOverSlot === cell.slotIndex ? 'ring-4 ring-cyan-400/80 ' : ''}${
                    !cell.cameraId
                      ? 'border-slate-800/80 hover:border-slate-700'
                      : cell.streamUrl && cameras.find((c: any) => c.id === cell.cameraId)?.operationalStatus !== 'offline'
                        ? 'border-emerald-500'
                        : 'border-amber-400'
                  } ${isSelected ? 'ring-2 ring-cyan-400' : ''}`}
                >
                  {cell.streamUrl && !focus ? (
                    <div className="w-full h-full relative">
                      <div
                        draggable
                        data-slot-grip={cell.slotIndex}
                        onDragStart={(e) => startDrag(e, DRAG_SLOT, String(cell.slotIndex))}
                        onDragEnd={() => setDragOverSlot(null)}
                        onDoubleClick={(e) => e.stopPropagation()}
                        title={t('ui.liveGrid.dragToMove')}
                        className="absolute top-1.5 left-1/2 -translate-x-1/2 z-40 px-2.5 py-1 rounded-md bg-cyan-600 hover:bg-cyan-500 border border-cyan-300/60 text-white font-semibold shadow-lg shadow-cyan-950/50 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition flex items-center gap-1 text-[11px]"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                        {t('ui.liveGrid.dragShort')}
                      </div>
                      {pausedHidden ? <PausedHidden name={cell.cameraName} /> : <LiveHdPlayer
                        cameraId={cell.cameraId as string}
                        streamUrl={cell.streamUrl}
                        cameraName={cell.cameraName || t('ui.liveGrid.slot', { v0: cell.slotIndex + 1 })}
                        streamProfile={cell.streamProfile}
                        hasSubStream={cell.hasSubStream}
                        onToggleProfile={(next) =>
                          handleToggleCellProfile(cell.slotIndex, next)
                        }
                        onFatalError={() => handleStreamFailed(cell.slotIndex)}
                        className="w-full h-full"
                      />}
                      {cameras.find((c: any) => c.id === cell.cameraId)?.operationalStatus === 'offline' && (
                        <CameraOfflineBanner />
                      )}
                      {cell.streamProfile === 'sub' && cell.mainFailedFor === cell.cameraId && (
                        <div className="absolute bottom-2 left-2 right-2 z-20 px-2 py-1 rounded bg-amber-950/85 border border-amber-700/60 text-[11px] text-amber-200 pointer-events-none">
                          {t('ui.liveGrid.mainStreamFellBack')}
                        </div>
                      )}
                      {/* Top Action Buttons: below the player's badges. A star that is set stays visible. */}
                      <div className="absolute top-10 right-2 flex items-center gap-1 z-30">
                        {cell.cameraId && (
                          <span className={`flex items-center gap-1 transition ${favorites.has(cell.cameraId) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            <CameraQuickActions cameraId={cell.cameraId} deviceId={cameras.find((c: any) => c.id === cell.cameraId)?.deviceId} isFavorite={favorites.has(cell.cameraId)} onToggleFavorite={toggleFavorite} />
                          </span>
                        )}
                        <button
                          onClick={(e) => clearSlot(cell.slotIndex, e)}
                          className="p-1 bg-slate-900/80 hover:bg-rose-900/90 text-slate-300 hover:text-white rounded opacity-0 group-hover:opacity-100 transition"
                          title={t('ui.liveGrid.closeCamera')}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => {
                        setActiveSlot(cell.slotIndex);
                        setDrawerOpen(true);
                      }}
                      className="w-full h-full flex flex-col items-center justify-center text-slate-500 hover:text-slate-300 transition hover:bg-slate-800/40"
                    >
                      <Plus className="w-8 h-8 mb-1 stroke-1 text-slate-600" />
                      <span className="text-xs font-semibold">{t('ui.liveGrid.assignCamera')}</span>
                      <span className="text-[10px] text-slate-600 mt-0.5">
                        {t('ui.liveGrid.slot2')}{cell.slotIndex + 1}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* Camera Selection Drawer (Hierarchical Tree for Hundreds of Cameras) */}
        {drawerOpen && (
          <aside className="w-88 bg-slate-900 border-l border-slate-800 flex flex-col shrink-0 z-40 transition-all">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">{t('ui.liveGrid.cameraDirectory')}</h3>
                <p className="text-[11px] text-cyan-400">
                  {t('ui.liveGrid.assigningToSlot')}{activeSlot + 1} ({drawerCameras.length}{' '}{t('ui.liveGrid.available')}
                </p>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-200 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter by Site and Search */}
            <div className="p-3 border-b border-slate-800 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder={t('ui.liveGrid.searchByNameIpChannel')}
                  value={cameraSearch}
                  onChange={(e) => setCameraSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {sites.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                  <button
                    onClick={() => setSelectedSiteFilter('all')}
                    className={`px-2 py-0.5 rounded-full border transition whitespace-nowrap ${
                      selectedSiteFilter === 'all'
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {t('ui.liveGrid.allSites')}{cameras.length})
                  </button>
                  {sites.map((s: any) => {
                    const siteCamCount = cameras.filter((c: any) => c.siteId === s.id).length;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSiteFilter(s.id)}
                        className={`px-2 py-0.5 rounded-full border transition whitespace-nowrap ${
                          selectedSiteFilter === s.id
                            ? 'bg-cyan-950 text-cyan-300 border-cyan-500/50'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {s.name} ({siteCamCount})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Hierarchical Tree List */}
            <div className="flex-1 overflow-auto p-2 space-y-2">
              {/* Dev Test Streams: test patterns for the Dev box, shown only in a build with VITE_SHOW_DEV_STREAMS=true */}
              {import.meta.env.VITE_SHOW_DEV_STREAMS === 'true' && (
              <div className="p-2 rounded-lg border border-cyan-900/60 bg-cyan-950/20 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400 flex items-center justify-between">
                  <span>{t('ui.liveGrid.devSyntheticStreams')}</span>
                  <span className="text-[9px] text-slate-500">{t('ui.liveGrid.builtIn')}</span>
                </div>
                <div
                  onClick={() => {
                    assignCameraToSlot(
                      { id: 'sim-1', name: 'Dev Simulator - Ch 1', streamPath: 'sim/ch1' },
                      activeSlot
                    );
                    setDrawerOpen(false);
                  }}
                  className="p-1.5 rounded bg-cyan-950/60 hover:bg-cyan-900/50 cursor-pointer transition flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-cyan-200 font-medium">{t('ui.liveGrid.devSim1ColorGrid')}</span>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div
                  onClick={() => {
                    assignCameraToSlot(
                      { id: 'sim-2', name: 'Dev Simulator - Ch 2 (Bars)', streamPath: 'sim/ch2' },
                      activeSlot
                    );
                    setDrawerOpen(false);
                  }}
                  className="p-1.5 rounded bg-cyan-950/60 hover:bg-cyan-900/50 cursor-pointer transition flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-cyan-200 font-medium">{t('ui.liveGrid.devSim2SmpteBars')}</span>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-cyan-400" />
                </div>
              </div>
              )}

              {/* Connected DVR Devices & Camera Groups */}
              {devices.length > 0 && (
                <div className="space-y-1">
                  <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {t('ui.liveGrid.dvrNvrDevices')}{devices.length})
                  </div>
                  {devices.map((dev: any) => {
                    const devCams = drawerCameras.filter((c: any) => c.deviceId === dev.id);
                    if (devCams.length === 0 && cameraSearch) return null;

                    return (
                      <div
                        key={dev.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden"
                      >
                        <div className="p-2 flex items-center justify-between hover:bg-slate-800/50">
                          <div className="flex items-center gap-2">
                            <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="text-xs font-semibold text-slate-200">{dev.name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              ({devCams.length}{' '}{t('ui.liveGrid.ch')}
                            </span>
                          </div>
                          {devCams.length > 0 && (
                            <button
                              onClick={() => handleDisplayGroupInGrid(devCams)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-cyan-600 hover:text-white text-[10px] text-slate-300 font-medium transition"
                              title={t('ui.liveGrid.displayAllChannelsInCurrentGrid')}
                            >
                              {t('ui.liveGrid.displayAll')}
                            </button>
                          )}
                        </div>

                        {/* Channels list under device */}
                        <div className="px-2 pb-1.5 space-y-1">
                          {devCams.map((cam: any) => (
                            <div
                              key={cam.id}
                              draggable
                              data-drawer-camera={cam.id}
                              onDragStart={(e) => startDrag(e, DRAG_CAMERA, cam.id)}
                              onDragEnd={() => setDragOverSlot(null)}
                              title={t('ui.liveGrid.dragToSlot')}
                              onClick={() => pickIntoSlot(cam)}
                              className="group/cam p-1.5 rounded border border-slate-900 bg-slate-900/60 hover:bg-slate-800 hover:border-cyan-800/60 cursor-grab active:cursor-grabbing transition flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <GripVertical className="w-3 h-3 shrink-0 text-slate-600 group-hover/cam:text-cyan-400" />
                                <span
                                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                    cam.operationalStatus === 'online'
                                      ? 'bg-emerald-400'
                                      : 'bg-slate-600'
                                  }`}
                                />
                                <span className="text-slate-300 truncate">{cam.name}</span>
                              </div>
                              <Plus className="w-3.5 h-3.5 text-slate-500 hover:text-cyan-400 shrink-0" />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* All Individual Cameras List */}
              <div className="space-y-1 pt-2">
                <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                  <span>{t('ui.liveGrid.allCameras')}</span>
                  <span className="font-mono text-slate-500">{drawerCameras.length}</span>
                </div>

                {drawerCameras.map((cam: any) => (
                  <div
                    key={cam.id}
                    draggable
                    data-drawer-camera={cam.id}
                    onDragStart={(e) => startDrag(e, DRAG_CAMERA, cam.id)}
                    onDragEnd={() => setDragOverSlot(null)}
                    title={t('ui.liveGrid.dragToSlot')}
                    onClick={() => pickIntoSlot(cam)}
                    className="p-2 rounded-lg border border-slate-800/80 bg-slate-950/40 hover:bg-slate-800 cursor-pointer transition flex items-center justify-between"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            cam.operationalStatus === 'online' ? 'bg-emerald-400' : 'bg-slate-600'
                          }`}
                        />
                        <span className="text-xs font-semibold text-slate-200 truncate">
                          {cam.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-slate-500 font-mono">
                          {cam.ipAddress || (cam.rtspUrl ? 'RTSP' : 'SMB')}
                        </span>
                        {cam.rtspUrlSub && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/40">
                            {t('ui.liveGrid.dual')}
                          </span>
                        )}
                      </div>
                    </div>
                    <Plus className="w-4 h-4 text-slate-400 hover:text-cyan-400 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </div>

      <LiveViewsModal
        open={presetModalOpen}
        onClose={() => setPresetModalOpen(false)}
        layout={layout}
        currentSlots={cells.slice(0, slotCount).filter((c) => c.cameraId).map((c) => ({ slotIndex: c.slotIndex, cameraId: c.cameraId! }))}
        canShare={canShareViews}
        onLoad={handleLoadPreset}
      />
    </div>
  );
}
