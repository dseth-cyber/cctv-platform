import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import { formatFileSize, getLocalizedValue } from '@/utils/textUtils';
import { Modal, Button, SearchableSelect, TableSkeleton, CountUpValue, ColumnSelector, type ColumnDef, BulkJobProgressModal, type BulkJobState } from '@/components/ui';
import {
  Search, ChevronUp, ChevronDown, ChevronsUpDown, Eye, Trash2,
  Download, Image, FileImage, Tag, Info, X, Filter, Plus, RefreshCw, FolderOpen,
  AlertTriangle, Undo2, Lock, Unlock, Camera, Activity, User,
} from 'lucide-react';

// Configurable data columns for the results table (in default order). The row
// checkbox and the actions column are always shown and handled separately.
const SEARCH_COLUMN_KEYS = ['index', 'cameraName', 'viewpoint', 'filename', 'status', 'source', 'fileSize', 'processedSize', 'captured'] as const;
const SEARCH_COLUMN_SORT: Record<string, string | undefined> = {
  cameraName: 'cameraName', filename: 'originalFilename', status: 'status',
  source: 'source', fileSize: 'fileSizeBytes', processedSize: 'processedFileSizeBytes', captured: 'capturedAt',
};

// Controls the "filter settings" dropdown can show/hide — the filter inputs plus
// the bulk-delete / unlock-all action buttons that share the same row.
const SEARCH_FILTER_KEYS = ['q', 'camera', 'status', 'locked', 'dateRange', 'tags', 'customer', 'jobType', 'bulkDelete', 'unlockAll'] as const;

function parseFilePath(originalFilename: string): { basename: string; subFolder: string } {
  const normalized = originalFilename.replace(/\\/g, '/').replace(/^\/+/, '');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash === -1) return { basename: normalized, subFolder: '' };
  return {
    basename: normalized.slice(lastSlash + 1),
    subFolder: normalized.slice(0, lastSlash),
  };
}

const FILE_TYPE_ORDER: Record<string, number> = { raw: 0, thumbnail: 1, processed: 2 };

const IMAGE_STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-500/20 text-green-400',
  processing: 'bg-blue-500/20 text-blue-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  failed: 'bg-red-500/20 text-red-400',
  deleted: 'bg-gray-500/20 text-gray-400',
  queued: 'bg-cyan-500/20 text-cyan-400',
};

export default function ImageServiceSearch() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, updateUiPreferences } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'system';

  // Per-user table/filter preferences (persisted server-side, follows the user
  // across devices). Initialized from the user object, saved on every change.
  const savedPrefs = (user?.uiPreferences?.imageSearch ?? {}) as { hiddenFilters?: string[]; columnOrder?: string[]; hiddenColumns?: string[] };
  const [hiddenFilters, setHiddenFilters] = useState<string[]>(savedPrefs.hiddenFilters ?? []);
  const [columnOrder, setColumnOrder] = useState<string[]>(
    savedPrefs.columnOrder?.length ? savedPrefs.columnOrder : [...SEARCH_COLUMN_KEYS],
  );
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(savedPrefs.hiddenColumns ?? []);

  const persistSearchPrefs = useCallback((patch: Partial<{ hiddenFilters: string[]; columnOrder: string[]; hiddenColumns: string[] }>) => {
    updateUiPreferences({ imageSearch: { hiddenFilters, columnOrder, hiddenColumns, ...patch } });
  }, [updateUiPreferences, hiddenFilters, columnOrder, hiddenColumns]);

  const applyFilterChange = (hidden: string[]) => { setHiddenFilters(hidden); persistSearchPrefs({ hiddenFilters: hidden }); };
  const applyColumnChange = (order: string[], hidden: string[]) => { setColumnOrder(order); setHiddenColumns(hidden); persistSearchPrefs({ columnOrder: order, hiddenColumns: hidden }); };
  const showFilter = (key: string) => !hiddenFilters.includes(key);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || '';
  });
  const [cameraId, setCameraId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [locked, setLocked] = useState('');
  const [customer, setCustomer] = useState('');
  const [jobType, setJobType] = useState('');
  const [sortCol, setSortCol] = useState('capturedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [detailId, setDetailId] = useState<string | null>(null);

  const [tagKey, setTagKey] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');
  const [thumbError, setThumbError] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [showLockForm, setShowLockForm] = useState(false);
  const [lockReasonInput, setLockReasonInput] = useState('');
  const [unlockAllOpen, setUnlockAllOpen] = useState(false);
  const [unlockAllPassword, setUnlockAllPassword] = useState('');
  const [unlockingAll, setUnlockingAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteDays, setBulkDeleteDays] = useState(30);
  const [bulkDeleteMode, setBulkDeleteMode] = useState<'files_only' | 'entire_record'>('entire_record');
  const [bulkDeleteFileTypes, setBulkDeleteFileTypes] = useState<string[]>(['raw']);
  const [bulkDeletePreview, setBulkDeletePreview] = useState<{ count: number; cutoffDate: string } | null>(null);
  const [bulkDeletePassword, setBulkDeletePassword] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteLoadingPreview, setBulkDeleteLoadingPreview] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashData, setTrashData] = useState<any>(null);
  const [trashPage, setTrashPage] = useState(1);
  const [trashLoading, setTrashLoading] = useState(false);
  const [emptyTrashPassword, setEmptyTrashPassword] = useState('');
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const [trashQ, setTrashQ] = useState('');
  const [trashCameraId, setTrashCameraId] = useState('');
  const [trashStartDate, setTrashStartDate] = useState('');
  const [trashEndDate, setTrashEndDate] = useState('');
  const [trashSelected, setTrashSelected] = useState<Set<string>>(new Set());
  const [showBulkDeleteTrashConfirm, setShowBulkDeleteTrashConfirm] = useState(false);
  const [bulkDeleteTrashPassword, setBulkDeleteTrashPassword] = useState('');
  const [trashBulkRestoring, setTrashBulkRestoring] = useState(false);
  const [trashBulkDeleting, setTrashBulkDeleting] = useState(false);
  const [limit, setLimit] = useState(50);
  const [bulkDeleteCameraIds, setBulkDeleteCameraIds] = useState<string[]>([]);
  // Drives BulkJobProgressModal — shared by search-page bulk-delete, empty-trash and
  // trash bulk-delete-selected, since all three now run as background jobs (see
  // incident_2026-08-06: synchronous per-file deletes on a few thousand+ files blew
  // past nginx's 60s proxy_read_timeout and looked like a hang/error to the user).
  const [bulkJobId, setBulkJobId] = useState<string | null>(null);
  const [bulkJobTitle, setBulkJobTitle] = useState<string>('');
  // Separate from bulkJobId on purpose: closing the modal only hides it (bulkJobModalVisible
  // -> false) — polling keeps running as long as bulkJobId is set, so a toast can still
  // fire when the job finishes even after the user dismissed the modal.
  const [bulkJobModalVisible, setBulkJobModalVisible] = useState(false);

  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => imageServiceApi.getCameras(),
    staleTime: 1000 * 60 * 5,
  });

  // Map a camera's viewpoint code (e.g. 'top') to its localized label (บน) for
  // the search table's viewpoint column.
  const { data: viewpointsRaw } = useQuery({
    queryKey: ['masterdata-image-viewpoints'],
    queryFn: () => imageServiceApi.getMasterdata({ type: 'image_viewpoint' }, { silent403: true }),
    staleTime: 1000 * 60 * 5,
  });
  const viewpoints = (viewpointsRaw?.data ?? viewpointsRaw ?? []) as any[];
  const viewpointLabel = (code: string | null | undefined) => {
    if (!code) return '—';
    const vp = viewpoints.find((v: any) => v.code === code);
    return vp ? getLocalizedValue(vp, i18n.language) : code;
  };

  const { data: overview } = useQuery({
    queryKey: ['image-service-overview-search'],
    queryFn: () => imageServiceApi.getOverview(),
    refetchInterval: 1000 * 30,
  });

  const { data: trends } = useQuery({
    queryKey: ['executive-trends-search'],
    queryFn: () => imageServiceApi.getTrends('7d'),
    refetchInterval: 1000 * 30,
  });

  const trackColor = themeConfig.name === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';

  const { data, isLoading } = useQuery({
    queryKey: ['images', page, limit, search, cameraId, status, from, to, locked, customer, jobType, tagKey, tagValue, sortCol, sortDir],
    queryFn: async () => {
      const res = await imageServiceApi.getImages({
        page, limit, cameraId: cameraId || undefined,
        status: status || undefined, q: search || undefined,
        from: from || undefined, to: to || undefined,
        locked: locked ? (locked as 'true' | 'false') : undefined,
        customer: customer || undefined, jobType: jobType || undefined,
        tagKey: tagKey || undefined, tagValue: tagValue || undefined,
        sort: sortCol, order: sortDir,
      });
      return {
        items: res.data ?? [],
        total: res.pagination?.total ?? 0,
        totalPages: res.pagination?.totalPages ?? 0,
      };
    },
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
    // Poll fast while any row on this page is still in flight (e.g. right after
    // Reprocess), so status flips to completed/failed without a manual refresh —
    // and stop polling once nothing is pending, to avoid needless load otherwise.
    refetchInterval: (query) => {
      const rows = query.state.data?.items ?? [];
      const hasInFlight = rows.some((i: any) => i.status === 'pending' || i.status === 'queued' || i.status === 'processing');
      return hasInFlight ? 5000 : false;
    },
  });

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 0;
  const totalItems = data?.total ?? 0;

  const { data: detail } = useQuery({
    queryKey: ['image-detail', detailId],
    queryFn: () => { setThumbError(false); setThumbSrc(null); return imageServiceApi.getImage(detailId!); },
    enabled: !!detailId,
  });

  useEffect(() => {
    if (!detail?.id || !detail.imageFiles?.some((f: any) => f.fileType === 'thumbnail')) return;
    let cancelled = false;
    const blobUrls: string[] = [];
    (async () => {
      try {
        const blob = await imageServiceApi.getImageFileBlob(detail.id, 'thumbnail');
        if (!cancelled) { const url = URL.createObjectURL(blob); blobUrls.push(url); setThumbSrc(url); }
      } catch { if (!cancelled) setThumbError(true); }
    })();
    return () => { cancelled = true; blobUrls.forEach(u => URL.revokeObjectURL(u)); };
  }, [detail?.id]);

  const handleSort = (col: string) => {
    if (col === 'actions' || col === 'no') return;
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(1);
  };

  const handleDownload = useCallback(async (id: string, fileType: string, filename?: string) => {
    const token = localStorage.getItem('accessToken');
    const base = (window as any).__API_BASE__ ?? '/image-service';
    try {
      const res = await fetch(`${base}/api/v1/images/${id}/files/${fileType}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        if (res.status === 500) toast.error(t('imageService.search.fileExpired'));
        else toast.error(t('common.error'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? `${id}-${fileType}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('common.error'));
    }
  }, [t, toast]);

  const handleReprocess = useCallback(async (id: string) => {
    try {
      await imageServiceApi.reprocessImage(id);
      toast.success(t('imageService.search.reprocessQueued'));
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['image-detail', id] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  }, [t, toast, queryClient]);

  const handleBulkReprocess = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    let ok = 0;
    for (const id of ids) {
      try { await imageServiceApi.reprocessImage(id); ok++; } catch { /* skip */ }
    }
    toast.success(`${t('imageService.search.reprocessQueued')} (${ok}/${ids.length})`);
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['images'] });
  }, [selected, t, toast, queryClient]);

  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);

  const handleBulkDeleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    setShowDeleteSelectedConfirm(true);
  }, [selected]);

  const confirmDeleteSelected = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeletingSelected(true);
    try {
      const result = await imageServiceApi.bulkDeleteSelected(ids);
      toast.success(`${t('imageService.search.deleteSuccess')} (${result.deleted}/${ids.length})`);
      setSelected(new Set());
      setShowDeleteSelectedConfirm(false);
      queryClient.invalidateQueries({ queryKey: ['images'] });
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'));
    } finally {
      setDeletingSelected(false);
    }
  }, [selected, t, toast, queryClient]);

  const handleBulkLock = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    let ok = 0;
    for (const id of ids) {
      try { await imageServiceApi.lockImage(id, {}); ok++; } catch { /* skip */ }
    }
    toast.success(`${t('imageService.search.lockSuccess')} (${ok}/${ids.length})`);
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['images'] });
  }, [selected, t, toast, queryClient]);

  const handleBulkUnlock = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    let ok = 0, denied = 0;
    for (const id of ids) {
      try { await imageServiceApi.unlockImage(id); ok++; }
      catch (e: any) { if (e?.response?.status === 403) denied++; }
    }
    toast.success(`${t('imageService.search.unlockSuccess')} (${ok}/${ids.length})`);
    if (denied > 0) toast.error(t('imageService.search.unlockDeniedCount', 'ปลดล็อกไม่ได้ {{count}} รูป (ล็อกโดยผู้ใช้อื่น/บทบาทสูงกว่า)', { count: denied }));
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['images'] });
  }, [selected, t, toast, queryClient]);

  const handleUnlockAll = useCallback(async () => {
    if (!unlockAllPassword) return;
    setUnlockingAll(true);
    try {
      const res = await imageServiceApi.unlockAllImages(unlockAllPassword);
      toast.success(t('imageService.search.unlockAllSuccess', 'ปลดล็อกทั้งหมดแล้ว {{count}} รูป', { count: res.unlocked }));
      setUnlockAllOpen(false);
      setUnlockAllPassword('');
      queryClient.invalidateQueries({ queryKey: ['images'] });
    } catch (e: any) {
      if (e?.response?.status === 401) toast.error(t('imageService.auditLog.bulkDeleteWrongPassword', 'รหัสผ่านไม่ถูกต้อง'));
      else if (e?.response?.status === 403) toast.error(t('imageService.search.unlockAllForbidden', 'เฉพาะผู้ดูแลระบบ (admin) เท่านั้น'));
      else if (!e?._handled) toast.error(t('common.error'));
    } finally {
      setUnlockingAll(false);
    }
  }, [unlockAllPassword, t, toast, queryClient]);

  const toggleSelect = (id: string) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const toggleSelectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.id)));
  };

  const handleDelete = async (id: string) => {
    try {
      await imageServiceApi.deleteImage(id);
      toast.success(t('imageService.search.deleteSuccess'));
      queryClient.invalidateQueries({ queryKey: ['images'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  };

  const handleLock = async (id: string) => {
    try {
      await imageServiceApi.lockImage(id, { reason: lockReasonInput || undefined });
      toast.success(t('imageService.search.lockSuccess'));
      setShowLockForm(false);
      setLockReasonInput('');
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['image-detail', id] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  };

  const handleUnlock = async (id: string) => {
    try {
      await imageServiceApi.unlockImage(id);
      toast.success(t('imageService.search.unlockSuccess'));
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['image-detail', id] });
    } catch (e: any) {
      if (e?.response?.status === 403) toast.error(t('imageService.search.unlockDenied', 'ไม่มีสิทธิ์ปลดล็อก — รูปนี้ถูกล็อกโดยผู้ใช้อื่นหรือบทบาทที่สูงกว่า'));
      else if (!e?._handled) toast.error(t('common.error'));
    }
  };

  const BULK_DELETE_DAY_OPTIONS = [0, 1, 3, 7, 15, 30, 90, 180, 270, 365];

  const fetchBulkDeletePreview = useCallback(async (
    days: number,
    camIds: string[],
    mode: 'files_only' | 'entire_record' = bulkDeleteMode,
    fileTypesList: string[] = bulkDeleteFileTypes
  ) => {
    setBulkDeleteLoadingPreview(true);
    setBulkDeletePreview(null);
    try {
      const result = await imageServiceApi.bulkDeletePreview(
        days,
        camIds.length > 0 ? camIds : undefined,
        mode === 'files_only' ? fileTypesList : undefined,
        mode
      );
      setBulkDeletePreview(result);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setBulkDeleteLoadingPreview(false);
    }
  }, [t, toast, bulkDeleteMode, bulkDeleteFileTypes]);

  const handleOpenBulkDelete = useCallback(() => {
    setBulkDeleteOpen(true);
    setBulkDeletePassword('');
    setBulkDeletePreview(null);
    setBulkDeleteDays(30);
    setBulkDeleteMode('entire_record');
    setBulkDeleteFileTypes(['raw']);
    setBulkDeleteCameraIds([]);
    fetchBulkDeletePreview(30, [], 'entire_record', ['raw']);
  }, [fetchBulkDeletePreview]);

  const handleBulkDeleteDaysChange = useCallback((days: number) => {
    setBulkDeleteDays(days);
    fetchBulkDeletePreview(days, bulkDeleteCameraIds, bulkDeleteMode, bulkDeleteFileTypes);
  }, [fetchBulkDeletePreview, bulkDeleteCameraIds, bulkDeleteMode, bulkDeleteFileTypes]);

  const handleBulkDeleteCameraChange = useCallback((cameraIds: string[]) => {
    setBulkDeleteCameraIds(cameraIds);
    fetchBulkDeletePreview(bulkDeleteDays, cameraIds, bulkDeleteMode, bulkDeleteFileTypes);
  }, [fetchBulkDeletePreview, bulkDeleteDays, bulkDeleteMode, bulkDeleteFileTypes]);

  const handleRemoveBulkDeleteCamera = useCallback((camId: string) => {
    setBulkDeleteCameraIds(prev => {
      const next = prev.filter(id => id !== camId);
      fetchBulkDeletePreview(bulkDeleteDays, next, bulkDeleteMode, bulkDeleteFileTypes);
      return next;
    });
  }, [fetchBulkDeletePreview, bulkDeleteDays, bulkDeleteMode, bulkDeleteFileTypes]);

  const handleBulkDeleteModeChange = useCallback((mode: 'files_only' | 'entire_record') => {
    setBulkDeleteMode(mode);
    fetchBulkDeletePreview(bulkDeleteDays, bulkDeleteCameraIds, mode, bulkDeleteFileTypes);
  }, [fetchBulkDeletePreview, bulkDeleteDays, bulkDeleteCameraIds, bulkDeleteFileTypes]);

  const handleBulkDeleteFileTypesToggle = useCallback((type: string, checked: boolean) => {
    setBulkDeleteFileTypes(prev => {
      const next = checked ? [...prev, type] : prev.filter(t => t !== type);
      fetchBulkDeletePreview(bulkDeleteDays, bulkDeleteCameraIds, bulkDeleteMode, next);
      return next;
    });
  }, [fetchBulkDeletePreview, bulkDeleteDays, bulkDeleteCameraIds, bulkDeleteMode]);

  const handleBulkDelete = useCallback(async () => {
    if (!bulkDeletePassword || !bulkDeletePreview) return;
    setBulkDeleting(true);
    try {
      const result: any = await imageServiceApi.bulkDeleteByAge(
        bulkDeleteDays,
        bulkDeletePassword,
        bulkDeleteCameraIds.length > 0 ? bulkDeleteCameraIds : undefined,
        bulkDeleteMode === 'files_only' ? bulkDeleteFileTypes : undefined,
        bulkDeleteMode
      );
      setBulkDeleteOpen(false);
      setBulkDeletePassword('');
      setBulkDeletePreview(null);
      if (result.jobId) {
        // files_only mode: background job — open the progress modal instead of a toast
        setBulkJobTitle(t('imageService.search.bulkDeleteJobTitle', 'กำลังลบไฟล์'));
        setBulkJobId(result.jobId);
        setBulkJobModalVisible(true);
      } else {
        toast.success(t('imageService.search.bulkDeleteSuccess', { count: result.deleted }));
        queryClient.invalidateQueries({ queryKey: ['images'] });
        queryClient.invalidateQueries({ queryKey: ['queue-health-global'] });
      }
    } catch (e: any) {
      if (e?.response?.status === 401) {
        toast.error(t('imageService.search.bulkDeleteWrongPassword'));
      } else if (!e?._handled) {
        toast.error(t('common.error'));
      }
    } finally {
      setBulkDeleting(false);
    }
  }, [bulkDeleteDays, bulkDeletePassword, bulkDeletePreview, bulkDeleteCameraIds, bulkDeleteMode, bulkDeleteFileTypes, t, toast, queryClient]);

  const handleBulkJobDone = useCallback((job: BulkJobState) => {
    queryClient.invalidateQueries({ queryKey: ['images'] });
    queryClient.invalidateQueries({ queryKey: ['queue-health-global'] });
    // Toast fires here regardless of whether the modal is still visible — the poll that
    // led here keeps running in the background even after the user closes the modal
    // (see bulkJobModalVisible). Only stop tracking once the job has actually finished.
    if (job.status === 'completed') {
      const deleted = (job.result as any)?.deleted ?? job.done;
      toast.success(t('imageService.search.bulkDeleteSuccess', { count: deleted }));
    } else {
      toast.error(t('common.error'));
    }
    setBulkJobId(null);
    setBulkJobModalVisible(false);
  }, [queryClient, t, toast]);

  // Trash Bin handlers
  // Debounce filename search typing
  const [debouncedTrashQ, setDebouncedTrashQ] = useState('');
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTrashQ(trashQ);
    }, 300);
    return () => clearTimeout(handler);
  }, [trashQ]);

  const fetchTrash = useCallback(async (pg: number = 1) => {
    setTrashLoading(true);
    try {
      const result = await imageServiceApi.getTrashImages({
        page: pg,
        limit: 20,
        q: debouncedTrashQ || undefined,
        cameraId: trashCameraId || undefined,
        startDate: trashStartDate || undefined,
        endDate: trashEndDate || undefined,
      });
      setTrashData(result);
      setTrashPage(pg);
      setTrashSelected(new Set()); // Reset on change
    } catch {
      toast.error(t('common.error'));
    } finally {
      setTrashLoading(false);
    }
  }, [t, toast, debouncedTrashQ, trashCameraId, trashStartDate, trashEndDate]);

  // Auto-fetch trash when active filters change
  useEffect(() => {
    if (trashOpen) {
      fetchTrash(1);
    }
  }, [fetchTrash, trashOpen]);

  const handleOpenTrash = useCallback(() => {
    setTrashOpen(true);
    setShowEmptyConfirm(false);
    setShowBulkDeleteTrashConfirm(false);
    setEmptyTrashPassword('');
    setBulkDeleteTrashPassword('');
    setTrashQ('');
    setTrashCameraId('');
    setTrashStartDate('');
    setTrashEndDate('');
    setTrashSelected(new Set());
  }, []);

  const handleRestoreImage = useCallback(async (id: string) => {
    try {
      await imageServiceApi.restoreImage(id);
      toast.success(t('imageService.search.restoreSuccess'));
      fetchTrash(trashPage);
      queryClient.invalidateQueries({ queryKey: ['images'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  }, [trashPage, t, toast, queryClient, fetchTrash]);

  const handleRestoreAll = useCallback(async () => {
    try {
      const result = await imageServiceApi.restoreAllImages();
      toast.success(t('imageService.search.restoreAllSuccess', { count: result.restored }));
      fetchTrash(1);
      queryClient.invalidateQueries({ queryKey: ['images'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  }, [t, toast, queryClient, fetchTrash]);

  const handleEmptyTrash = useCallback(async () => {
    if (!emptyTrashPassword) return;
    try {
      const result = await imageServiceApi.emptyTrash(emptyTrashPassword);
      setShowEmptyConfirm(false);
      setEmptyTrashPassword('');
      setTrashOpen(false);
      setBulkJobTitle(t('imageService.search.emptyTrashJobTitle', 'กำลังล้างถังขยะ'));
      setBulkJobId(result.jobId);
      setBulkJobModalVisible(true);
    } catch (e: any) {
      if (e?.response?.status === 401) {
        toast.error(t('imageService.search.bulkDeleteWrongPassword'));
      } else if (!e?._handled) {
        toast.error(t('common.error'));
      }
    }
  }, [emptyTrashPassword, t, toast]);

  const handleTrashSelectToggle = (id: string) => {
    setTrashSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTrashSelectAllToggle = () => {
    const list = trashData?.data ?? [];
    if (list.length === 0) return;
    setTrashSelected(prev => {
      const allSelected = list.every((item: any) => prev.has(item.id));
      const next = new Set(prev);
      if (allSelected) {
        list.forEach((item: any) => next.delete(item.id));
      } else {
        list.forEach((item: any) => next.add(item.id));
      }
      return next;
    });
  };

  const handleRestoreSelectedTrash = async () => {
    if (trashSelected.size === 0) return;
    setTrashBulkRestoring(true);
    try {
      const ids = Array.from(trashSelected);
      await imageServiceApi.restoreImagesBulk(ids);
      toast.success(t('imageService.search.restoreSuccess'));
      fetchTrash(trashPage);
      queryClient.invalidateQueries({ queryKey: ['images'] });
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'));
    } finally {
      setTrashBulkRestoring(false);
    }
  };

  const handleDeleteSelectedTrashPermanently = async () => {
    if (trashSelected.size === 0 || !bulkDeleteTrashPassword) return;
    setTrashBulkDeleting(true);
    try {
      const ids = Array.from(trashSelected);
      const result = await imageServiceApi.deleteImagesBulkPermanently(ids, bulkDeleteTrashPassword);
      setShowBulkDeleteTrashConfirm(false);
      setBulkDeleteTrashPassword('');
      setTrashOpen(false);
      setBulkJobTitle(t('imageService.search.bulkDeleteJobTitle', 'กำลังลบไฟล์'));
      setBulkJobId(result.jobId);
      setBulkJobModalVisible(true);
    } catch (e: any) {
      if (e?.response?.status === 401) {
        toast.error(t('imageService.search.bulkDeleteWrongPassword'));
      } else if (!e?._handled) {
        toast.error(t('common.error'));
      }
    } finally {
      setTrashBulkDeleting(false);
    }
  };

  const thCls = (col: string) =>
    `px-4 py-3 text-left text-sm font-semibold cursor-pointer select-none hover:text-cyan-300 ${themeConfig.text.primary}`;

  const statusOptions = ['pending', 'queued', 'processing', 'completed', 'failed', 'deleted', 'archived'].map(s => ({
    value: s, label: t(`common.${s}`) ?? s,
  }));

  // Column config for the show/hide + reorder selector, and dynamic table render.
  const columnLabels: Record<string, string> = {
    index: t('imageService.search.rowNo', 'ลำดับ'),
    cameraName: t('imageService.cameras.cameraName'),
    viewpoint: t('imageService.cameras.viewpoint', 'มุมมองภาพ'),
    filename: t('imageService.search.filename'),
    status: t('imageService.cameras.status'),
    source: t('imageService.search.source'),
    fileSize: t('imageService.storage.totalSize'),
    processedSize: t('imageService.search.processedSize'),
    captured: t('imageService.search.captured'),
  };
  const columnDefs: ColumnDef[] = SEARCH_COLUMN_KEYS.map(k => ({ key: k, label: columnLabels[k] }));

  const filterLabels: Record<string, string> = {
    q: t('imageService.search.searchPlaceholder'),
    camera: t('imageService.search.allCameras'),
    status: t('imageService.cameras.status'),
    locked: t('imageService.search.allLockStates', 'ทุกสถานะล็อก'),
    dateRange: t('imageService.search.captured'),
    tags: t('imageService.search.tagKey'),
    customer: t('imageService.productionRuns.customer', 'ลูกค้า'),
    jobType: t('imageService.productionRuns.jobType', 'ประเภทงาน'),
    bulkDelete: t('imageService.search.bulkDelete'),
    unlockAll: t('imageService.search.unlockAll', 'ปลดล็อกทุกรูป'),
  };
  // Only offer the action toggles to users who can actually use them.
  const filterDefs: ColumnDef[] = SEARCH_FILTER_KEYS
    .filter(k => (k === 'bulkDelete' ? hasPermission(user, 'search:delete') : k === 'unlockAll' ? isAdmin : true))
    .map(k => ({ key: k, label: filterLabels[k] }));
  // Saved order first, then any columns not yet in the saved order (e.g. added later).
  const effectiveOrder = [
    ...columnOrder.filter(k => (SEARCH_COLUMN_KEYS as readonly string[]).includes(k)),
    ...SEARCH_COLUMN_KEYS.filter(k => !columnOrder.includes(k)),
  ];
  const visibleColumns = effectiveOrder.filter(k => !hiddenColumns.includes(k));

  const renderHeaderCell = (key: string) => {
    const sortKey = SEARCH_COLUMN_SORT[key];
    const label = columnLabels[key];
    if (!sortKey) {
      return <th key={key} className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{label}</th>;
    }
    return (
      <th key={key} onClick={() => handleSort(sortKey)} className={thCls(sortKey)}>
        <div className="flex items-center gap-1">{label}
          {sortCol === sortKey ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
      </th>
    );
  };

  const renderCell = (key: string, item: any, idx: number) => {
    switch (key) {
      case 'index':
        return <td key={key} className={`px-4 py-3 text-sm ${themeConfig.text.primary}`}>{(page - 1) * limit + idx + 1}</td>;
      case 'cameraName':
        return (
          <td key={key} className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
            <span>{item.cameraName ?? '—'}</span>
            {item.customer && (
              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-cyan-400" title={t('imageService.productionRuns.title', 'รอบการผลิต')}>
                <User size={10} className="shrink-0" />
                {item.customer}{item.jobType ? ` · ${item.jobType}` : ''}
              </span>
            )}
          </td>
        );
      case 'viewpoint':
        return <td key={key} className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{viewpointLabel(item.cameraViewpoint)}</td>;
      case 'filename':
        return (
          <td key={key} className={`px-4 py-3 text-sm ${themeConfig.text.primary}`}>
            {(() => { const { basename, subFolder } = parseFilePath(item.originalFilename); return (
              <div>
                <span>{basename}</span>
                {item.locked && <Lock size={11} className="inline ml-1.5 text-red-400" />}
                {subFolder && (
                  <span className={`ml-1.5 inline-flex items-center gap-0.5 text-[10px] ${themeConfig.text.secondary}`}>
                    <FolderOpen size={10} /> {subFolder}
                  </span>
                )}
              </div>
            ); })()}
          </td>
        );
      case 'status':
        return (
          <td key={key} className="px-4 py-3">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${IMAGE_STATUS_COLORS[item.status] ?? 'bg-gray-500/20 text-gray-400'}`}>
              {t('common.' + item.status) ?? item.status}
            </span>
          </td>
        );
      case 'source':
        return (
          <td key={key} className="px-4 py-3">
            {(() => {
              const isCamera = /^\d{8}_\d{6}/.test(item.originalFilename.replace(/^.*[/\\]/, ''));
              return (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isCamera ? 'bg-cyan-500/20 text-cyan-400' : 'bg-purple-500/20 text-purple-400'}`}>
                  {isCamera ? t('imageService.search.sourceCamera') : t('imageService.search.sourceSpecial')}
                </span>
              );
            })()}
          </td>
        );
      case 'fileSize':
        return <td key={key} className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{formatFileSize(item.fileSizeBytes)}</td>;
      case 'processedSize':
        return <td key={key} className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{formatFileSize(item.processedFileSizeBytes)}</td>;
      case 'captured':
        return <td key={key} className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{item.capturedAt ? formatDateTime(item.capturedAt, i18n.language) : '—'}</td>;
      default:
        return null;
    }
  };

  return (
    <div className="pt-6 px-6 pb-2.5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-6">
        <div className="shrink-0">
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            Image Service · {t('imageService.search.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.search.title')}</h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.search.subtitle')}</p>
        </div>
        
        {/* Compact Summary Metrics - Full Width */}
        <div className={`flex-1 w-full lg:w-auto lg:ml-8 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 px-6 py-3.5 rounded-lg border ${themeConfig.card} ${themeConfig.inputBorder}`}>
          {/* Metric 1: Today's Images */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10 shrink-0">
              <FileImage size={18} className="text-purple-400" />
            </div>
            <div>
              <p className={`text-[10px] uppercase tracking-wider font-semibold ${themeConfig.text.secondary}`}>
                {t('imageService.trends.todayImages')}
              </p>
              <p className="text-xl font-bold text-purple-300">
                <CountUpValue value={overview?.imagesToday ?? trends?.today?.images ?? 0} />
              </p>
            </div>
          </div>

          {/* Metric 2: Total Images */}
          <div className="flex items-center gap-3 border-l border-slate-200 dark:border-white/10 pl-4 md:pl-6">
            <div className="p-2 rounded-lg bg-cyan-500/10 shrink-0">
              <Image size={18} className="text-cyan-400" />
            </div>
            <div>
              <p className={`text-[10px] uppercase tracking-wider font-semibold ${themeConfig.text.secondary}`}>
                {t('imageService.overview.totalImages')}
              </p>
              <p className="text-xl font-bold text-cyan-300">
                <CountUpValue value={overview?.totalImages ?? (data as any)?.pagination?.total ?? (data as any)?.total ?? 0} />
              </p>
            </div>
          </div>

          {/* Metric 3: Active Cameras */}
          <div className="flex items-center gap-3 border-t md:border-t-0 md:border-l border-slate-200 dark:border-white/10 pt-3 md:pt-0 md:pl-6">
            <div className={`p-2 rounded-lg shrink-0 ${(overview?.camerasOffline ?? 0) > 0 ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
              <Camera size={18} className={(overview?.camerasOffline ?? 0) > 0 ? 'text-red-400' : 'text-green-400'} />
            </div>
            <div>
              <p className={`text-[10px] uppercase tracking-wider font-semibold ${themeConfig.text.secondary}`}>
                {t('imageService.overview.onlineCameras', 'กล้องออนไลน์ (ติดต่อได้จริง)')}
              </p>
              <p className={`text-xl font-bold ${(overview?.camerasOffline ?? 0) > 0 ? 'text-red-300' : 'text-green-300'}`}>
                <CountUpValue value={overview?.camerasOnline ?? cameras.filter((c: any) => c.status === 'active' || c.enabled).length} /> / <CountUpValue value={overview ? ((overview.activeCameras ?? 0) + (overview.inactiveCameras ?? 0) + (overview.errorCameras ?? 0) + (overview.maintenanceCameras ?? 0)) : cameras.length} />
              </p>
              {overview && (
                <p className={`text-[10px] ${(overview.camerasOffline ?? 0) > 0 ? 'text-red-400' : themeConfig.text.secondary}`}>
                  {[
                    `${t('imageService.overview.camWorking', 'ทำงาน')} ${overview.camerasOnline ?? 0}`,
                    ...(((overview.inactiveCameras ?? 0) + (overview.maintenanceCameras ?? 0) + (overview.errorCameras ?? 0)) > 0
                      ? [`${t('imageService.overview.camNotWorking', 'ไม่ทำงาน')} ${(overview.inactiveCameras ?? 0) + (overview.maintenanceCameras ?? 0) + (overview.errorCameras ?? 0)}`] : []),
                    ...((overview.camerasOffline ?? 0) > 0
                      ? [`⚠ ${t('imageService.overview.camUnreachable', 'เชื่อมต่อไม่ได้')} ${overview.camerasOffline}`] : []),
                  ].join(' · ')}
                </p>
              )}
            </div>
          </div>

          {/* Metric 4: Processing Status */}
          <div className="flex items-center gap-3 border-t md:border-t-0 border-l border-slate-200 dark:border-white/10 pt-3 md:pt-0 pl-4 md:pl-6">
            <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
              <Activity size={18} className="text-amber-400" />
            </div>
            <div>
              <p className={`text-[10px] uppercase tracking-wider font-semibold ${themeConfig.text.secondary}`}>
                {t('imageService.search.processingStatus')}
              </p>
              <div className="flex items-baseline gap-2.5">
                <span className="text-base font-bold text-green-400">
                  <CountUpValue value={overview?.completedToday ?? overview?.completed ?? 0} /><span className="text-[9px] font-normal ml-0.5 text-gray-400">{t('common.completed')}</span>
                </span>
                <span className="text-base font-bold text-red-400">
                  <CountUpValue value={overview?.failedToday ?? overview?.failed ?? 0} /><span className="text-[9px] font-normal ml-0.5 text-gray-400">{t('common.failed')}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* relative z-20: themeConfig.card uses backdrop-blur which creates a stacking
          context, so the table card below (also a card) would otherwise paint over
          the settings popovers. Lifting this card above it keeps the dropdowns on top. */}
      <div className={`${themeConfig.card} rounded-lg p-4 mb-5 relative z-20`}>
        <div className="flex items-center gap-3">
          {/* Filter settings — first in the row, before the search box */}
          <ColumnSelector
            columns={filterDefs}
            order={[...SEARCH_FILTER_KEYS]}
            hidden={hiddenFilters}
            onChange={(_order, hidden) => applyFilterChange(hidden)}
            reorderable={false}
            align="left"
            label={t('imageService.search.settings', 'ตั้งค่า')}
            buttonClassName={`px-3 py-2 rounded-md text-xs flex items-center gap-1.5 border ${themeConfig.inputBorder} ${themeConfig.text.secondary} hover:bg-white/5 transition-colors h-[38px] shrink-0`}
          />
          <div className="flex flex-nowrap items-center gap-3 overflow-x-auto pb-1 [&>*]:shrink-0 flex-1 min-w-0">
          {showFilter('q') && (
          <div className="relative w-44 min-w-[130px]">
            <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${themeConfig.text.secondary}`} />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder={t('imageService.search.searchPlaceholder')}
              className={`w-full pl-9 pr-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
          </div>
          )}
          {showFilter('camera') && (
          <div className="w-40">
            <SearchableSelect value={cameraId} onChange={v => { setCameraId(v); setPage(1); }}
              placeholder={t('imageService.search.allCameras')}
              options={[{ value: '', label: t('imageService.search.allCameras') }, ...((cameras as any).data ?? cameras).map((c: any) => ({ value: c.id, label: c.name }))]} />
          </div>
          )}

          {showFilter('status') && (
          <div className="w-36">
            <SearchableSelect value={status} onChange={v => { setStatus(v); setPage(1); }}
              placeholder={t('imageService.search.allStatus')} options={statusOptions} />
          </div>
          )}
          {showFilter('locked') && (
          <div className="w-36">
            <SearchableSelect value={locked} onChange={v => { setLocked(v); setPage(1); }}
              placeholder={t('imageService.search.allLockStates', 'ทุกสถานะล็อก')}
              options={[
                { value: '', label: t('imageService.search.allLockStates', 'ทุกสถานะล็อก') },
                { value: 'true', label: t('imageService.search.lockedOnly', 'เฉพาะที่ล็อก 🔒') },
                { value: 'false', label: t('imageService.search.unlockedOnly', 'เฉพาะที่ไม่ล็อก') },
              ]} />
          </div>
          )}
          {showFilter('dateRange') && (<>
          <div>
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
              className={`px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} h-[38px] w-[130px]`} />
          </div>
          <span className={`text-xs ${themeConfig.text.secondary}`}>—</span>
          <div>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
              className={`px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} h-[38px] w-[130px]`} />
          </div>
          </>)}
          {showFilter('tags') && (<>
          <div className="w-28">
            <input value={tagKey} onChange={e => { setTagKey(e.target.value); setPage(1); }}
              placeholder={t('imageService.search.tagKey')}
              className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} h-[38px]`} />
          </div>
          <div className="w-28">
            <input value={tagValue} onChange={e => { setTagValue(e.target.value); setPage(1); }}
              placeholder={t('imageService.search.tagValue')}
              className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} h-[38px]`} />
          </div>
          </>)}
          {showFilter('customer') && (
          <div className="w-32">
            <input value={customer} onChange={e => { setCustomer(e.target.value); setPage(1); }}
              placeholder={t('imageService.productionRuns.customer', 'ลูกค้า')}
              className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} h-[38px]`} />
          </div>
          )}
          {showFilter('jobType') && (
          <div className="w-32">
            <input value={jobType} onChange={e => { setJobType(e.target.value); setPage(1); }}
              placeholder={t('imageService.productionRuns.jobType', 'ประเภทงาน')}
              className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} h-[38px]`} />
          </div>
          )}
          {(status || from || to || locked || tagKey || tagValue || customer || jobType) && (
            <button onClick={() => {
              setStatus('');
              setFrom('');
              setTo('');
              setLocked('');
              setTagKey('');
              setTagValue('');
              setCustomer('');
              setJobType('');
              setPage(1);
            }}
              className="px-3 py-2 rounded-md text-xs font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors h-[38px] flex items-center justify-center gap-1.5"
              title="Clear all filters"
            >
              <X size={13} /> {t('imageService.search.clearFilter') || 'Clear'}
            </button>
          )}
          {hasPermission(user, 'search:delete') && showFilter('bulkDelete') && (
            <button onClick={handleOpenBulkDelete}
              className="px-3 py-2 rounded-md text-xs flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors h-[38px]">
              <Trash2 size={13} /> {t('imageService.search.bulkDelete')}
            </button>
          )}
          <button onClick={handleOpenTrash}
            className="px-3 py-2 rounded-md text-xs flex items-center gap-1.5 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors h-[38px]">
            <Trash2 size={13} /> {t('imageService.search.trashBin')}
          </button>
          {isAdmin && showFilter('unlockAll') && (
            <button onClick={() => { setUnlockAllPassword(''); setUnlockAllOpen(true); }}
              className="px-3 py-2 rounded-md text-xs flex items-center gap-1.5 border border-slate-400/40 text-slate-300 hover:bg-slate-500/10 transition-colors h-[38px]">
              <Unlock size={13} /> {t('imageService.search.unlockAll', 'ปลดล็อกทุกรูป')}
            </button>
          )}
          </div>
          {/* Table settings — last in the row */}
          <ColumnSelector
            columns={columnDefs}
            order={effectiveOrder}
            hidden={hiddenColumns}
            onChange={applyColumnChange}
            label={t('imageService.search.tableSettings', 'ตั้งค่าตาราง')}
          />
        </div>
      </div>

      {selected.size > 0 && (
        <div className={`${themeConfig.card} rounded-lg px-4 py-2.5 mb-3 flex items-center gap-3`}>
          <span className={`text-xs ${themeConfig.text.primary}`}>
            {t('imageService.search.selected', { count: selected.size })}
          </span>
          <button onClick={handleBulkReprocess}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5">
            <RefreshCw size={12} /> {t('imageService.search.reprocessSelected')}
          </button>
          {hasPermission(user, 'search:update') && (
            <>
              <button onClick={handleBulkLock}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-600 hover:bg-slate-700 text-white flex items-center gap-1.5">
                <Lock size={12} /> {t('imageService.search.lockSelected', 'ล็อกที่เลือก')}
              </button>
              <button onClick={handleBulkUnlock}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-500 hover:bg-slate-600 text-white flex items-center gap-1.5">
                <Unlock size={12} /> {t('imageService.search.unlockSelected', 'ปลดล็อกที่เลือก')}
              </button>
            </>
          )}
          {hasPermission(user, 'search:delete') && (
            <button onClick={handleBulkDeleteSelected}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5">
              <Trash2 size={12} /> {t('imageService.search.deleteSelected')}
            </button>
          )}
          <button onClick={() => setSelected(new Set())}
            className={`px-3 py-1.5 rounded-md text-xs ${themeConfig.text.secondary} hover:bg-white/5`}>
            {t('imageService.search.clearSelection')}
          </button>
        </div>
      )}

      {isLoading ? <TableSkeleton rows={8} /> : (
        <div className={`${themeConfig.card} rounded-lg overflow-hidden flex flex-col mb-2`}>
          <div className="overflow-x-auto overflow-y-auto relative" style={{ height: 'calc(100vh - 372px)', maxHeight: 'calc(100vh - 372px)' }}>
            <table className="w-full relative border-collapse">
              <thead className={`${themeConfig.tableHeader} sticky top-0 z-10 shadow-sm`}>
                <tr>
                  <th className="px-2 py-3 w-8">
                    <input type="checkbox" checked={items.length > 0 && selected.size === items.length}
                      onChange={toggleSelectAll} className="rounded border-gray-500 cursor-pointer" />
                  </th>
                  {visibleColumns.map(key => renderHeaderCell(key))}
                  <th className={`px-4 py-3 text-center text-sm font-semibold ${themeConfig.text.primary}`}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${themeConfig.tableDivide}`}>
                {items.map((item: any, idx: number) => (
                  <tr key={item.id} className={`border-b ${themeConfig.tableBorder} ${themeConfig.tableRow}`}>
                    <td className="px-2 py-3 w-8">
                      <input type="checkbox" checked={selected.has(item.id)}
                        onChange={() => toggleSelect(item.id)} className="rounded border-gray-500 cursor-pointer" />
                    </td>
                    {visibleColumns.map(key => renderCell(key, item, idx))}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setDetailId(item.id)}
                          className="p-2 rounded-lg hover:bg-blue-500/20"><Eye size={15} className="text-blue-500" /></button>
                        <button onClick={() => handleReprocess(item.id)}
                          className="p-2 rounded-lg hover:bg-amber-500/20" title={t('imageService.search.reprocess')}><RefreshCw size={15} className="text-amber-500" /></button>
                        <button onClick={() => handleDelete(item.id)}
                          className="p-2 rounded-lg hover:bg-red-500/20"><Trash2 size={15} className="text-red-500" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {items.length === 0 && (
              <div className={`text-center py-12 ${themeConfig.text.secondary} text-sm bg-black/5`}>
                {t('imageService.search.noResults')}
              </div>
            )}
          </div>

          <div className="py-2.5 px-4 border-t flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-950/20" style={{ borderColor: trackColor }}>
            <div className="flex items-center gap-2 text-xs">
              <span className={themeConfig.text.secondary}>{t('imageService.search.rowsPerPage', 'แสดงต่อหน้า:')}</span>
              <div className="w-24">
                <SearchableSelect
                  value={String(limit)}
                  onChange={v => {
                    setLimit(Number(v));
                    setPage(1);
                  }}
                  showSearch={false}
                  options={[10, 50, 100, 250, 500, 750, 1000, 2000, 3000, 4000, 5000].map(val => ({
                    value: String(val),
                    label: String(val)
                  }))}
                />
              </div>
              <span className={`ml-2 px-2 py-1 rounded bg-white/5 border border-white/10 ${themeConfig.text.secondary}`}>
                {t('imageService.search.totalImages', 'พบทั้งหมด {{count}} ภาพ', { count: 0 })} <CountUpValue value={totalItems} isLoading={isLoading} />
              </span>
            </div>

            {totalPages > 0 && (
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <button disabled={page <= 1} onClick={() => setPage(1)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                  « {t('common.first') || 'หน้าแรก'}
                </button>
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                  ‹ {t('common.prev')}
                </button>
                <div className="flex items-center gap-1 text-xs">
                  <input
                    type="number" min={1} max={totalPages || 1}
                    value={page}
                    onChange={e => {
                      const v = parseInt(e.target.value);
                      if (v >= 1 && v <= totalPages) setPage(v);
                    }}
                    className={`w-14 px-2 py-1.5 rounded-lg text-center border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary}`} />
                  <span className={themeConfig.text.secondary}>/ {totalPages || 1}</span>
                </div>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                  {t('common.next')} ›
                </button>
                <button disabled={page >= totalPages} onClick={() => setPage(totalPages || 1)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                  {t('common.last') || 'หน้าสุด'} »
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal isOpen={!!detailId} onClose={() => setDetailId(null)} title={t('imageService.search.imageDetail')}>
        {detail && (
          <div className="space-y-5 p-1 max-w-2xl">
            <div className="flex items-center gap-4">
              <div className="w-32 h-32 rounded-lg overflow-hidden flex-shrink-0">
                {thumbSrc
                  ? <img src={thumbSrc}
                      alt={detail.originalFilename}
                      className="w-full h-full object-cover"
                      onError={() => { setThumbSrc(null); setThumbError(true); }} />
                  : thumbError
                    ? <div className="w-32 h-32 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                        <Image size={48} className="text-cyan-400/60" />
                      </div>
                    : <div className="w-32 h-32 rounded-lg bg-white/5 flex items-center justify-center">
                        <div className="animate-pulse w-8 h-8 rounded-full bg-white/10" />
                      </div>}
              </div>
              <div className="flex-1">
                <h3 className={`text-lg font-semibold ${themeConfig.text.primary}`}>{parseFilePath(detail.originalFilename).basename}</h3>
                {parseFilePath(detail.originalFilename).subFolder && (
                  <p className={`text-xs flex items-center gap-1 ${themeConfig.text.secondary}`}>
                    <FolderOpen size={11} /> {parseFilePath(detail.originalFilename).subFolder}
                  </p>
                )}
                <p className={`text-xs ${themeConfig.text.secondary}`}>ID: {detail.id}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${IMAGE_STATUS_COLORS[detail.status]}`}>{t('common.' + detail.status) ?? detail.status}</span>
                  {detail.locked && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-300"
                      title={detail.lockReason ? `${t('imageService.search.lockedBy')}: ${detail.lockedBy} — ${detail.lockReason}` : `${t('imageService.search.lockedBy')}: ${detail.lockedBy}`}>
                      <Lock size={10} /> {t('imageService.search.locked')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h4 className={`text-sm font-semibold mb-2 flex items-center gap-1.5 ${themeConfig.text.primary}`}>
                <Info size={14} /> {t('imageService.search.metadata')}
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  [t('imageService.search.dimensions'), detail.widthPx && detail.heightPx ? `${detail.widthPx} × ${detail.heightPx}` : '—'],
                  [t('imageService.search.bitDepth'), detail.bitDepth ?? '—'],
                  [t('imageService.search.colorSpace'), detail.colorSpace ?? '—'],
                  [t('imageService.search.compression'), detail.compressionType ?? '—'],
                  [t('imageService.search.fileSize'), formatFileSize(detail.fileSizeBytes)],
                  [t('imageService.search.sha256'), detail.checksumSha256 ? detail.checksumSha256.slice(0, 16) + '...' : '—'],
                  [t('imageService.search.captured'), detail.capturedAt ? formatDateTime(detail.capturedAt, i18n.language) : '—'],
                  [t('imageService.search.processed'), detail.processedAt ? formatDateTime(detail.processedAt, i18n.language) : '—'],
                ].map(([k, v], i) => (
                  <div key={i} className={`px-3 py-2 rounded-lg ${themeConfig.card}`}>
                    <span className={themeConfig.text.secondary}>{k}</span>
                    <p className={`font-medium mt-0.5 ${themeConfig.text.primary}`}>{v}</p>
                  </div>
                ))}
              </div>
            </div>

            {detail.imageFiles?.length > 0 && (
              <div>
                <h4 className={`text-sm font-semibold mb-2 flex items-center gap-1.5 ${themeConfig.text.primary}`}>
                  <FileImage size={14} /> {t('imageService.search.files')}
                </h4>
                <div className="flex gap-2 flex-wrap">
                    {[...detail.imageFiles].sort((a: any, b: any) =>
                      (FILE_TYPE_ORDER[a.fileType] ?? 99) - (FILE_TYPE_ORDER[b.fileType] ?? 99)
                    ).map((f: any) => (
                      <button key={f.id} onClick={() => handleDownload(detail.id, f.fileType, parseFilePath(detail.originalFilename).basename)}
                      className={`px-3 py-2 rounded-md text-xs flex items-center gap-1.5 border ${themeConfig.inputBorder} ${themeConfig.text.primary} hover:bg-white/5 transition-colors cursor-pointer`}>
                      <Download size={12} /> {t(`imageService.search.fileType${f.fileType.charAt(0).toUpperCase() + f.fileType.slice(1)}`)}
                      {f.fileSizeBytes ? ` (${formatFileSize(f.fileSizeBytes)})` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className={`text-sm font-semibold mb-2 flex items-center gap-1.5 ${themeConfig.text.primary}`}>
                <Tag size={14} /> {t('imageService.search.tags')}
              </h4>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {(detail.imageTags ?? []).map((tag: any) => (
                    <span key={tag.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-cyan-500/10 text-cyan-400">
                      {tag.key}: {tag.value}
                      <button onClick={async () => {
                        try {
                          await imageServiceApi.deleteImageTag(detail.id, tag.key);
                          toast.success(t('imageService.search.tagDeleted'));
                          queryClient.invalidateQueries({ queryKey: ['image-detail', detailId] });
                          queryClient.invalidateQueries({ queryKey: ['images'] });
                        } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
                      }}
                        className="hover:text-red-400 transition-colors">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input value={newTagKey} onChange={e => setNewTagKey(e.target.value)}
                    placeholder={t('imageService.search.tagKeyPlaceholder')}
                    className={`w-28 px-2 py-1.5 rounded-md text-xs border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
                  <input value={newTagValue} onChange={e => setNewTagValue(e.target.value)}
                    placeholder={t('imageService.search.tagValuePlaceholder')}
                    className={`w-32 px-2 py-1.5 rounded-md text-xs border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && (newTagKey.trim() || newTagValue.trim())) {
                        const key = newTagKey.trim() || newTagValue.trim();
                        const value = newTagValue.trim() || newTagKey.trim();
                        try {
                          await imageServiceApi.upsertImageTags(detail.id, { [key]: value });
                          toast.success(t('imageService.search.tagAdded'));
                          setNewTagKey('');
                          setNewTagValue('');
                          queryClient.invalidateQueries({ queryKey: ['image-detail', detailId] });
                          queryClient.invalidateQueries({ queryKey: ['images'] });
                        } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
                      }
                    }} />
                  <button onClick={async () => {
                    if (!newTagKey.trim() && !newTagValue.trim()) return;
                    const key = newTagKey.trim() || newTagValue.trim();
                    const value = newTagValue.trim() || newTagKey.trim();
                    try {
                      await imageServiceApi.upsertImageTags(detail.id, { [key]: value });
                      toast.success(t('imageService.search.tagAdded'));
                      setNewTagKey('');
                      setNewTagValue('');
                      queryClient.invalidateQueries({ queryKey: ['image-detail', detailId] });
                      queryClient.invalidateQueries({ queryKey: ['images'] });
                    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
                  }}
                    className="p-1.5 rounded-md bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors disabled:opacity-30"
                    disabled={!newTagKey.trim() && !newTagValue.trim()}>
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t" style={{ borderColor: trackColor }}>
              <h4 className={`text-sm font-semibold mb-2 flex items-center gap-1.5 ${themeConfig.text.primary}`}>
                <Lock size={14} /> {t('imageService.search.lockSection')}
              </h4>
              {detail.locked ? (
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${themeConfig.card}`}>
                  <div className="text-xs">
                    <p className={themeConfig.text.secondary}>
                      {t('imageService.search.lockedBy')}: <span className={themeConfig.text.primary}>{detail.lockedBy}</span>
                    </p>
                    {detail.lockReason && <p className={`mt-0.5 ${themeConfig.text.secondary}`}>{detail.lockReason}</p>}
                  </div>
                  <button onClick={() => handleUnlock(detail.id)}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-green-600 hover:bg-green-700 text-white flex items-center gap-1.5">
                    <Unlock size={12} /> {t('imageService.search.unlock')}
                  </button>
                </div>
              ) : showLockForm ? (
                <div className="flex items-center gap-2">
                  <input value={lockReasonInput} onChange={e => setLockReasonInput(e.target.value)}
                    placeholder={t('imageService.search.lockReasonPlaceholder')}
                    className={`flex-1 px-3 py-2 rounded-md text-xs border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary}`} />
                  <button onClick={() => handleLock(detail.id)}
                    className="px-3 py-2 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5">
                    <Lock size={12} /> {t('imageService.search.lockConfirm')}
                  </button>
                  <button onClick={() => { setShowLockForm(false); setLockReasonInput(''); }}
                    className={`px-3 py-2 rounded-md text-xs ${themeConfig.text.secondary} hover:bg-white/5`}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowLockForm(true)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border ${themeConfig.inputBorder} ${themeConfig.text.primary} hover:bg-white/5 flex items-center gap-1.5`}>
                  <Lock size={12} /> {t('imageService.search.lock')}
                </button>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: trackColor }}>
              <Button variant="secondary" onClick={() => setDetailId(null)}>{t('common.close')}</Button>
              <Button onClick={async () => {
                try {
                  await imageServiceApi.reprocessImage(detail.id);
                  toast.success(t('imageService.search.reprocessQueued'));
                  queryClient.invalidateQueries({ queryKey: ['images'] });
                  queryClient.invalidateQueries({ queryKey: ['image-detail', detailId] });
                } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
              }} className="!bg-amber-600 hover:!bg-amber-700 text-white">
                <RefreshCw size={14} className="mr-1.5" /> {t('imageService.search.reprocess')}
              </Button>
              <Button onClick={() => handleDelete(detail.id)} className="!bg-red-600 hover:!bg-red-700 text-white">
                <Trash2 size={14} className="mr-1.5" /> {t('imageService.search.deleteImage')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk Delete Modal */}
      <Modal isOpen={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} title={t('imageService.search.bulkDeleteTitle')}>
        <div className="space-y-5 p-1 max-w-md">
          <div className={`flex items-start gap-3 p-3 rounded-lg ${bulkDeleteMode === 'files_only' ? 'bg-red-500/10 border border-red-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
            <AlertTriangle size={18} className={`${bulkDeleteMode === 'files_only' ? 'text-red-400' : 'text-amber-400'} flex-shrink-0 mt-0.5`} />
            <p className={`text-xs ${themeConfig.text.secondary}`}>
              {bulkDeleteMode === 'files_only'
                ? 'คำเตือน: การลบไฟล์ดิบ/ไฟล์ผลลัพธ์จะลบออกจากระบบจัดเก็บข้อมูล (MinIO/SeaweedFS) ถาวรทันทีเพื่อคืนพื้นที่จัดเก็บ และไม่สามารถกู้คืนได้!'
                : t('imageService.search.bulkDeleteSoftNote')}
            </p>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
              {t('imageService.search.bulkDeleteAction', 'รูปแบบการดำเนินการ')}
            </label>
            <div className="space-y-2 border border-white/5 bg-black/10 p-3 rounded-lg">
              <label className="flex items-start gap-2 cursor-pointer text-xs">
                <input
                  type="radio"
                  name="bulkDeleteMode"
                  checked={bulkDeleteMode === 'entire_record'}
                  onChange={() => handleBulkDeleteModeChange('entire_record')}
                  className="mt-0.5 border-white/30 bg-white/10 text-cyan-500 focus:ring-cyan-500/50"
                />
                <div className="flex flex-col">
                  <span className={`font-semibold ${themeConfig.text.primary}`}>{t('imageService.search.bulkDeleteModeEntireRecord')}</span>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-xs pt-1 border-t border-white/5">
                <input
                  type="radio"
                  name="bulkDeleteMode"
                  checked={bulkDeleteMode === 'files_only'}
                  onChange={() => handleBulkDeleteModeChange('files_only')}
                  className="mt-0.5 border-white/30 bg-white/10 text-cyan-500 focus:ring-cyan-500/50"
                />
                <div className="flex flex-col">
                  <span className={`font-semibold ${themeConfig.text.primary}`}>{t('imageService.search.bulkDeleteModeFilesOnly')}</span>
                </div>
              </label>
            </div>
          </div>

          {bulkDeleteMode === 'files_only' && (
            <div className="p-3 rounded-lg border border-white/10 bg-white/5 space-y-2.5">
              <label className={`block text-xs font-semibold ${themeConfig.text.primary}`}>
                {t('imageService.search.bulkDeleteTargetFiles', 'ประเภทไฟล์เป้าหมาย')}
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={bulkDeleteFileTypes.includes('raw')}
                    onChange={(e) => handleBulkDeleteFileTypesToggle('raw', e.target.checked)}
                    className="rounded border-white/30 bg-white/10 text-cyan-500 focus:ring-cyan-500/50"
                  />
                  <span className={themeConfig.text.primary}>{t('imageService.search.bulkDeleteFileTypeRaw', 'ไฟล์ต้นฉบับ (Raw)')}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={bulkDeleteFileTypes.includes('processed')}
                    onChange={(e) => handleBulkDeleteFileTypesToggle('processed', e.target.checked)}
                    className="rounded border-white/30 bg-white/10 text-cyan-500 focus:ring-cyan-500/50"
                  />
                  <span className={themeConfig.text.primary}>{t('imageService.search.bulkDeleteFileTypeProcessed', 'ไฟล์ที่แปลงแล้ว (Processed)')}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={bulkDeleteFileTypes.includes('thumbnail')}
                    onChange={(e) => handleBulkDeleteFileTypesToggle('thumbnail', e.target.checked)}
                    className="rounded border-white/30 bg-white/10 text-cyan-500 focus:ring-cyan-500/50"
                  />
                  <span className={themeConfig.text.primary}>{t('imageService.search.bulkDeleteFileTypeThumbnail', 'ภาพขนาดย่อ (Thumbnail)')}</span>
                </label>
              </div>
              <p className="text-[10px] text-gray-400">
                {t('imageService.search.bulkDeleteFileTypesNote')}
              </p>
            </div>
          )}

          <div>
            <label className={`block text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
              {t('imageService.search.bulkDeleteCamera', 'ลบรูปจากกล้อง')}
            </label>
            <SearchableSelect
              isMulti
              selectedValues={bulkDeleteCameraIds}
              onMultiChange={handleBulkDeleteCameraChange}
              placeholder={t('imageService.search.selectCameras', 'เลือกกล้องเพื่อเพิ่ม...')}
              options={((cameras as any).data ?? cameras).map((c: any) => ({ value: c.id, label: c.name }))}
            />
            {bulkDeleteCameraIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-2 max-h-24 overflow-y-auto p-1.5 rounded border border-white/10 bg-white/5">
                {bulkDeleteCameraIds.map(id => {
                  const cam = ((cameras as any).data ?? cameras).find((c: any) => c.id === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-cyan-500/20 text-cyan-300">
                      {cam?.name || id}
                      <button
                        type="button"
                        onClick={() => handleRemoveBulkDeleteCamera(id)}
                        className="hover:text-red-400 font-bold ml-1 text-sm"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className={`text-xs ${themeConfig.text.secondary} mt-1`}>
                {t('imageService.search.allCamerasSelected', 'เลือกทั้งหมด (หากไม่เลือกกล้องใดเลยจะลบจากทุกกล้อง)')}
              </p>
            )}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
              {t('imageService.search.bulkDeleteDays')}
            </label>
            <SearchableSelect
              value={String(bulkDeleteDays)}
              onChange={v => handleBulkDeleteDaysChange(Number(v))}
              placeholder={t('imageService.search.bulkDeleteDays')}
              options={BULK_DELETE_DAY_OPTIONS.map(d => {
                let label = '';
                if (d === 0) label = t('imageService.search.allOption', 'ทั้งหมด');
                else if (d === 1) label = `1 ${t('imageService.search.days', 'วัน')}`;
                else if (d === 3) label = `3 ${t('imageService.search.days', 'วัน')}`;
                else if (d === 7) label = `7 ${t('imageService.search.days', 'วัน')}`;
                else if (d === 15) label = `15 ${t('imageService.search.days', 'วัน')}`;
                else if (d === 30) label = `1 ${t('imageService.search.month', 'เดือน')} (30 ${t('imageService.search.days', 'วัน')})`;
                else if (d === 90) label = `3 ${t('imageService.search.month', 'เดือน')} (90 ${t('imageService.search.days', 'วัน')})`;
                else if (d === 180) label = `6 ${t('imageService.search.month', 'เดือน')} (180 ${t('imageService.search.days', 'วัน')})`;
                else if (d === 270) label = `9 ${t('imageService.search.month', 'เดือน')} (270 ${t('imageService.search.days', 'วัน')})`;
                else if (d === 365) label = `1 ${t('imageService.search.year', 'ปี')} (365 ${t('imageService.search.days', 'วัน')})`;
                else label = `${d} ${t('imageService.search.days', 'วัน')}`;
                return { value: String(d), label };
              })}
            />
          </div>

          <div className={`p-3 rounded-lg ${themeConfig.card} border ${themeConfig.inputBorder}`}>
            {bulkDeleteLoadingPreview ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full" />
                <span className={`text-sm ${themeConfig.text.secondary}`}>...</span>
              </div>
            ) : bulkDeletePreview ? (
              <p className={`text-sm font-medium ${bulkDeletePreview.count > 0 ? 'text-red-400' : themeConfig.text.primary}`}>
                {bulkDeletePreview.cutoffDate 
                  ? t('imageService.search.bulkDeletePreview', {
                      count: Number(bulkDeletePreview.count),
                      date: bulkDeletePreview.cutoffDate.split('T')[0],
                    })
                  : t('imageService.search.bulkDeletePreviewAll', `จะลบทั้งหมด ${bulkDeletePreview.count.toLocaleString()} รายการ`, {
                      count: Number(bulkDeletePreview.count),
                    })
                }
              </p>
            ) : null}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.search.bulkDeleteConfirm')}
            </label>
            <input
              type="password" autoComplete="new-password"
              value={bulkDeletePassword}
              onChange={e => setBulkDeletePassword(e.target.value)}
              placeholder={t('imageService.search.bulkDeletePassword')}
              className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
              onKeyDown={e => { if (e.key === 'Enter' && bulkDeletePassword && bulkDeletePreview && bulkDeletePreview.count > 0) handleBulkDelete(); }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: trackColor }}>
            <Button variant="secondary" onClick={() => setBulkDeleteOpen(false)}>
              {t('common.close')}
            </Button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting || !bulkDeletePassword || !bulkDeletePreview || bulkDeletePreview.count === 0 || (bulkDeleteMode === 'files_only' && bulkDeleteFileTypes.length === 0)}
              className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
            >
              {bulkDeleting ? (
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Trash2 size={14} />
              )}
              {t('imageService.search.bulkDelete')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Trash Bin Modal */}
      <Modal isOpen={trashOpen} onClose={() => { setTrashOpen(false); setShowEmptyConfirm(false); setEmptyTrashPassword(''); }} title={t('imageService.search.trashTitle')} size="5xl">
        <div className="space-y-4 p-1 max-w-full">
          {/* Filters Row */}
          <div className="flex items-end gap-3 bg-white/5 p-3 rounded-lg border border-white/10">
            <div className="flex-1">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${themeConfig.text.secondary}`}>
                {t('imageService.search.filename')}
              </label>
              <input
                type="text"
                value={trashQ}
                onChange={e => setTrashQ(e.target.value)}
                className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50 h-[38px]`}
                placeholder="Search file name..."
              />
            </div>
            <div className="w-48">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${themeConfig.text.secondary}`}>
                {t('imageService.cameras.cameraName')}
              </label>
              <SearchableSelect
                value={trashCameraId}
                onChange={v => setTrashCameraId(v)}
                placeholder="All cameras"
                options={[
                  { value: '', label: 'All cameras' },
                  ...((cameras as any).data ?? cameras).map((c: any) => ({ value: c.id, label: c.name }))
                ]}
              />
            </div>
            <div className="w-36">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${themeConfig.text.secondary}`}>
                Start Date (ลบตั้งแต่)
              </label>
              <input
                type="date"
                value={trashStartDate}
                onChange={e => setTrashStartDate(e.target.value)}
                className={`w-full px-3 py-2 border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} rounded-md text-sm focus:outline-none h-[38px]`}
              />
            </div>
            <div className="w-36">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${themeConfig.text.secondary}`}>
                End Date (ลบถึง)
              </label>
              <input
                type="date"
                value={trashEndDate}
                onChange={e => setTrashEndDate(e.target.value)}
                className={`w-full px-3 py-2 border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} rounded-md text-sm focus:outline-none h-[38px]`}
              />
            </div>
            {(trashQ || trashCameraId || trashStartDate || trashEndDate) && (
              <button
                onClick={() => {
                  setTrashQ('');
                  setTrashCameraId('');
                  setTrashStartDate('');
                  setTrashEndDate('');
                }}
                className={`px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} hover:bg-white/5 text-gray-300 transition-colors h-[38px] flex items-center justify-center`}
                title="Clear filters"
              >
                Clear
              </button>
            )}
          </div>

          {/* Bulk selected action bar */}
          {trashSelected.size > 0 && (
            <div className="flex items-center justify-between p-2.5 bg-cyan-950/40 border border-cyan-800/40 rounded-lg text-xs text-cyan-200">
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {t('imageService.search.selected', { count: trashSelected.size }) || `${trashSelected.size} selected`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={trashBulkRestoring}
                  onClick={handleRestoreSelectedTrash}
                  className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
                >
                  <Undo2 size={12} /> {t('imageService.search.restore') || 'Restore'}
                </button>
                {hasPermission(user, 'search:delete') && (
                  <button
                    disabled={trashBulkDeleting}
                    onClick={() => {
                      setBulkDeleteTrashPassword('');
                      setShowBulkDeleteTrashConfirm(true);
                    }}
                    className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
                  >
                    <Trash2 size={12} /> {t('imageService.search.deletePermanently') || 'Delete Permanently'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bulk delete selected password confirm card */}
          {showBulkDeleteTrashConfirm && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className={`text-xs ${themeConfig.text.secondary}`}>
                  ยืนยันลบรูปภาพที่เลือก {trashSelected.size} รายการแบบถาวร? การดำเนินการนี้ไม่สามารถย้อนกลับได้
                </p>
              </div>
              <input
                type="password" autoComplete="new-password"
                value={bulkDeleteTrashPassword}
                onChange={e => setBulkDeleteTrashPassword(e.target.value)}
                className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
                placeholder={t('imageService.search.emptyTrashPassword')}
                onKeyDown={e => { if (e.key === 'Enter' && bulkDeleteTrashPassword) handleDeleteSelectedTrashPermanently(); }}
              />
              <div className="flex gap-2">
                <button onClick={() => { setShowBulkDeleteTrashConfirm(false); setBulkDeleteTrashPassword(''); }}
                  className={`px-3 py-1.5 rounded-md text-xs ${themeConfig.text.secondary} hover:bg-white/5`}>
                  {t('common.close')}
                </button>
                <button onClick={handleDeleteSelectedTrashPermanently} disabled={!bulkDeleteTrashPassword}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 flex items-center gap-1.5">
                  <Trash2 size={12} /> {t('imageService.search.deletePermanently') || 'ลบถาวร'}
                </button>
              </div>
            </div>
          )}

          {trashLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full" />
            </div>
          ) : trashData && trashData.data?.length > 0 ? (
            <>
              <p className={`text-sm font-medium ${themeConfig.text.secondary}`}>
                {t('imageService.search.trashCount', { count: trashData.pagination?.total ?? trashData.data.length })}
              </p>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className={themeConfig.tableHeader}>
                    <tr>
                      <th className="px-3 py-2 text-left w-10">
                        <input
                          type="checkbox"
                          checked={trashData.data.length > 0 && trashData.data.every((item: any) => trashSelected.has(item.id))}
                          onChange={handleTrashSelectAllToggle}
                          className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50 bg-white/10 cursor-pointer"
                        />
                      </th>
                      <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.primary}`}>#</th>
                      <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.primary}`}>{t('imageService.search.filename')}</th>
                      <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.cameraName')}</th>
                      <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.primary}`}>{t('imageService.search.size')}</th>
                      <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.primary}`}>{t('imageService.search.deletedAt')}</th>
                      <th className={`px-3 py-2 text-center text-xs font-semibold ${themeConfig.text.primary}`}>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${themeConfig.tableDivide}`}>
                    {trashData.data.map((item: any, idx: number) => (
                      <tr key={item.id} className={`border-b ${themeConfig.tableBorder} ${themeConfig.tableRow}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={trashSelected.has(item.id)}
                            onChange={() => handleTrashSelectToggle(item.id)}
                            className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50 bg-white/10 cursor-pointer"
                          />
                        </td>
                        <td className={`px-3 py-2 text-xs ${themeConfig.text.primary}`}>{(trashPage - 1) * 20 + idx + 1}</td>
                        <td className={`px-3 py-2 text-xs ${themeConfig.text.primary}`}>
                          {parseFilePath(item.originalFilename).basename}
                        </td>
                        <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                          {item.camera?.name ?? '—'}
                        </td>
                        <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                          {formatFileSize(item.fileSizeBytes)}
                        </td>
                        <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                          {item.deletedAt ? formatDateTime(item.deletedAt, i18n.language) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center">
                            <button onClick={() => handleRestoreImage(item.id)}
                              className="p-1.5 rounded-lg hover:bg-green-500/20 text-green-400"
                              title={t('imageService.search.restore')}>
                              <Undo2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {trashData.pagination && trashData.pagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button disabled={trashPage <= 1} onClick={() => fetchTrash(trashPage - 1)}
                    className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                    {t('common.prev')}
                  </button>
                  <span className={`text-xs ${themeConfig.text.secondary}`}>{trashPage} / {trashData.pagination.totalPages}</span>
                  <button disabled={trashPage >= trashData.pagination.totalPages} onClick={() => fetchTrash(trashPage + 1)}
                    className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                    {t('common.next')}
                  </button>
                </div>
              )}

              {showEmptyConfirm && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className={`text-xs ${themeConfig.text.secondary}`}>
                      {t('imageService.search.emptyTrashConfirm')}
                    </p>
                  </div>
                  <input
                    type="password" autoComplete="new-password"
                    value={emptyTrashPassword}
                    onChange={e => setEmptyTrashPassword(e.target.value)}
                    placeholder={t('imageService.search.emptyTrashPassword')}
                    className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
                    onKeyDown={e => { if (e.key === 'Enter' && emptyTrashPassword) handleEmptyTrash(); }}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => { setShowEmptyConfirm(false); setEmptyTrashPassword(''); }}
                      className={`px-3 py-1.5 rounded-md text-xs ${themeConfig.text.secondary} hover:bg-white/5`}>
                      {t('common.close')}
                    </button>
                    <button onClick={handleEmptyTrash} disabled={!emptyTrashPassword}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 flex items-center gap-1.5">
                      <Trash2 size={12} /> {t('imageService.search.emptyTrash')}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: trackColor }}>
                <Button variant="secondary" onClick={() => { setTrashOpen(false); setShowEmptyConfirm(false); setEmptyTrashPassword(''); }}>
                  {t('common.close')}
                </Button>
                <button
                  onClick={handleRestoreAll}
                  disabled={trashSelected.size > 0}
                  className="px-4 py-2 rounded-md text-sm font-medium bg-green-600 hover:bg-green-700 text-white flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Undo2 size={14} /> {t('imageService.search.restoreAll')}
                </button>
                {hasPermission(user, 'search:delete') && !showEmptyConfirm && (
                  <button
                    onClick={() => setShowEmptyConfirm(true)}
                    disabled={trashSelected.size > 0}
                    className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} /> {t('imageService.search.emptyTrash')}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className={`text-center py-12 ${themeConfig.text.secondary}`}>
              <Trash2 size={48} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">{t('imageService.search.trashEmpty')}</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Unlock-all Modal (admin only, password-confirmed) */}
      <Modal isOpen={unlockAllOpen} onClose={() => setUnlockAllOpen(false)} title={t('imageService.search.unlockAll', 'ปลดล็อกทุกรูป')}>
        <div className="space-y-5 p-1 max-w-md">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className={`text-xs ${themeConfig.text.secondary}`}>
              {t('imageService.search.unlockAllWarning', 'จะปลดล็อกรูปภาพที่ถูกล็อกไว้ทั้งหมดในระบบ (ทุกกล้อง/ทุกช่วงเวลา) ต้องเป็นผู้ดูแลระบบและยืนยันรหัสผ่าน')}
            </p>
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.auditLog.bulkDeleteConfirm', 'กรุณายืนยันรหัสผ่านเพื่อดำเนินการ')}
            </label>
            <input
              type="password" autoComplete="new-password"
              value={unlockAllPassword}
              onChange={e => setUnlockAllPassword(e.target.value)}
              placeholder={t('imageService.auditLog.bulkDeletePassword', 'รหัสผ่าน')}
              className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-slate-400/50`}
              onKeyDown={e => { if (e.key === 'Enter' && unlockAllPassword && !unlockingAll) handleUnlockAll(); }}
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
            <Button variant="secondary" onClick={() => setUnlockAllOpen(false)}>{t('common.close')}</Button>
            <button
              onClick={handleUnlockAll}
              disabled={unlockingAll || !unlockAllPassword}
              className="px-4 py-2 rounded-md text-sm font-medium bg-slate-600 hover:bg-slate-700 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
            >
              {unlockingAll ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Unlock size={14} />}
              {t('imageService.search.unlockAll', 'ปลดล็อกทุกรูป')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteSelectedConfirm}
        onClose={() => setShowDeleteSelectedConfirm(false)}
        title={t('imageService.search.deleteSelectedTitle', 'ลบภาพที่เลือก')}
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className={`text-xs ${themeConfig.text.secondary}`}>
              {t('imageService.search.deleteSelectedConfirm', { count: selected.size })}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowDeleteSelectedConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <button
              onClick={confirmDeleteSelected}
              disabled={deletingSelected}
              className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 flex items-center gap-1.5 transition-colors"
            >
              {deletingSelected ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> : <Trash2 size={14} />}
              {t('common.confirm', 'ยืนยัน')}
            </button>
          </div>
        </div>
      </Modal>

      <BulkJobProgressModal
        jobId={bulkJobId}
        visible={bulkJobModalVisible}
        title={bulkJobTitle}
        onClose={() => setBulkJobModalVisible(false)}
        onDone={handleBulkJobDone}
      />
    </div>
  );
}

const trackColor = 'rgba(255,255,255,0.08)';
