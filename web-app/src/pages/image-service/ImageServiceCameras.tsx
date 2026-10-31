import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import { Search, Plus, ChevronUp, ChevronDown, ChevronsUpDown,
  Edit, Trash2, Eye, Camera, Activity, Wifi, WifiOff, AlertTriangle, Wrench,
  FolderOpen, RefreshCw, CheckCircle, XCircle, ExternalLink, ChevronRight, Play, Undo2, Copy } from 'lucide-react';
import { Modal, Button, SearchableSelect, TableSkeleton, ColumnSelector, ExportButton, DateTimePicker } from '@/components/ui';
import { getLocalizedValue, translateSmbTestResult } from '@/utils/textUtils';
import { useRequiredFields } from '@/hooks/useRequiredFields';
import { catalogFieldsFor } from '@/config/requiredFieldsCatalog';

const CAMERA_STATUS_STYLES: Record<string, { bg: string; icon: any }> = {
  active: { bg: 'bg-green-500/20 text-green-400', icon: Wifi },
  inactive: { bg: 'bg-gray-500/20 text-gray-400', icon: WifiOff },
  error: { bg: 'bg-red-500/20 text-red-400', icon: AlertTriangle },
  maintenance: { bg: 'bg-yellow-500/20 text-yellow-400', icon: Wrench },
};

// Operational Status (P35): system-derived reachability, separate from the Business Status above.
const OPERATIONAL_STATUS_DOT: Record<string, string> = {
  online: 'bg-green-400',
  offline: 'bg-red-500 animate-pulse',
  recovering: 'bg-amber-400 animate-pulse',
  unknown: 'bg-gray-500',
};

const emptyForm = () => ({
  name: '', ipAddress: '', smbSharePath: '', smbDomain: '',
  smbUsername: '', smbPasswordEncrypted: '',
  pollIntervalSeconds: 30, captureMode: 'periodic',
  cameraTypeCode: '', viewpointCode: '', retentionPolicyId: '', description: '',
  // Template + per-camera processing overrides. Blank/'inherit' = inherit from template.
  templateId: '',
  acceptedExtensions: [] as string[],
  convertToPng: 'inherit', keepSmaller: 'inherit', generateThumbnail: 'inherit',
  thumbnailSize: '', compressionQuality: '',
  slaTargetPercent: '',
});

// Available source extensions for the per-camera override chip selector.
const SOURCE_EXTENSIONS = ['tif', 'tiff', 'ptif', 'ptiff', 'jpg', 'jpeg', 'png', 'bmp'];

// Convert tri-state form value -> payload (null = inherit).
const triToPayload = (v: string): boolean | null =>
  v === 'inherit' || v === '' ? null : v === 'true';
// Convert nullable boolean from API -> tri-state form value.
const boolToTri = (v: boolean | null | undefined): string =>
  v === null || v === undefined ? 'inherit' : v ? 'true' : 'false';

export default function ImageServiceCameras() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canUpdate = hasPermission(user, 'cameras:update');
  const canDelete = hasPermission(user, 'cameras:delete');
  const hasUsersPermission = hasPermission(user, 'users:read');
  const hasMasterdataPermission = hasPermission(user, 'masterdata:read');
  const contentRef = useRef<HTMLDivElement>(null);

  // Admin-configured required fields (Required Fields Settings page).
  // WIRED: the camera create/edit form + the incident status-change dialog below.
  const { isRequired: isCameraFieldRequired } = useRequiredFields('camera');
  const { isRequired: isIncidentFieldRequired } = useRequiredFields('incident');
  // Renders a red * when the given camera field is admin-configured as required
  // (skips fields already hard-marked in JSX to avoid a duplicate asterisk).
  const cameraStar = (key: string) =>
    isCameraFieldRequired(key) ? <span className="text-red-400"> *</span> : null;
  const incidentStar = (key: string) =>
    isIncidentFieldRequired(key) ? <span className="text-red-400"> *</span> : null;

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [modal, setModal] = useState<{ open: boolean; item?: any | null }>({ open: false });
  const [form, setForm] = useState(emptyForm());
  const [showOverrides, setShowOverrides] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<{ loading: boolean; success?: boolean; message?: string }>({ loading: false });
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseItems, setBrowseItems] = useState<Array<{ name: string; isDirectory: boolean }>>([]);
  const [browsePath, setBrowsePath] = useState('');
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseShares, setBrowseShares] = useState<Array<{ name: string; description: string }>>([]);
  const [browseStep, setBrowseStep] = useState<'shares' | 'files'>('shares');

  // Delete camera state
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; camera?: any }>({ open: false });
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Camera trash state
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashData, setTrashData] = useState<any[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const [emptyTrashPassword, setEmptyTrashPassword] = useState('');
  const [permaDeleteTarget, setPermaDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [permaDeletePassword, setPermaDeletePassword] = useState('');
  const [permaDeleting, setPermaDeleting] = useState(false);
  const [trashQ, setTrashQ] = useState('');
  const [trashStartDate, setTrashStartDate] = useState('');
  const [trashEndDate, setTrashEndDate] = useState('');
  const [debouncedTrashQ, setDebouncedTrashQ] = useState('');
  const [trashPage, setTrashPage] = useState(1);
  const [restoringAllTrash, setRestoringAllTrash] = useState(false);
  const [trashSelected, setTrashSelected] = useState<Set<string>>(new Set());
  const [showBulkDeleteTrashConfirm, setShowBulkDeleteTrashConfirm] = useState(false);
  const [bulkDeleteTrashPassword, setBulkDeleteTrashPassword] = useState('');
  const [trashBulkRestoring, setTrashBulkRestoring] = useState(false);
  const [trashBulkDeleting, setTrashBulkDeleting] = useState(false);
  const TRASH_PAGE_SIZE = 20;

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedTrashQ(trashQ), 300);
    return () => clearTimeout(handler);
  }, [trashQ]);

  useEffect(() => { setTrashPage(1); setTrashSelected(new Set()); }, [debouncedTrashQ, trashStartDate, trashEndDate]);

  const filteredTrashData = useMemo(() => {
    return trashData.filter((item: any) => {
      const q = debouncedTrashQ.trim().toLowerCase();
      const matchesQ = !q || item.name?.toLowerCase().includes(q) || item.ipAddress?.toLowerCase().includes(q);
      const deletedDate = item.deletedAt ? String(item.deletedAt).slice(0, 10) : '';
      const matchesStart = !trashStartDate || deletedDate >= trashStartDate;
      const matchesEnd = !trashEndDate || deletedDate <= trashEndDate;
      return matchesQ && matchesStart && matchesEnd;
    });
  }, [trashData, debouncedTrashQ, trashStartDate, trashEndDate]);

  const trashTotalPages = Math.max(1, Math.ceil(filteredTrashData.length / TRASH_PAGE_SIZE));
  const pagedTrashData = useMemo(
    () => filteredTrashData.slice((trashPage - 1) * TRASH_PAGE_SIZE, trashPage * TRASH_PAGE_SIZE),
    [filteredTrashData, trashPage],
  );

  // Bulk Selection and Actions State (Checkbox & Bulk Clone/Delete)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteModal, setBulkDeleteModal] = useState({ open: false });
  const [bulkDeletePassword, setBulkDeletePassword] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkCloneModal, setBulkCloneModal] = useState({ open: false });
  const [bulkCloning, setBulkCloning] = useState(false);

  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ['cameras-list', search, statusFilter],
    queryFn: () => imageServiceApi.getCameras({ status: statusFilter || undefined }),
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const { data: policies = [] } = useQuery({
    queryKey: ['retention-policies'],
    queryFn: () => imageServiceApi.getRetentionPolicies({ silent403: true }),
    staleTime: 1000 * 60 * 5,
  });

  const { data: cameraTypesRaw } = useQuery({
    queryKey: ['masterdata-camera-types'],
    queryFn: () => imageServiceApi.getMasterdata({ type: 'camera_type' }, { silent403: true }),
    staleTime: 1000 * 60 * 5,
    enabled: hasMasterdataPermission,
  });
  const cameraTypes = (cameraTypesRaw?.data ?? cameraTypesRaw ?? []) as any[];

  const { data: cameraStatusesRaw } = useQuery({
    queryKey: ['masterdata-camera-statuses'],
    queryFn: () => imageServiceApi.getMasterdata({ type: 'camera_status' }, { silent403: true }),
    staleTime: 1000 * 60 * 5,
    enabled: hasMasterdataPermission,
  });
  const cameraStatuses = (cameraStatusesRaw?.data ?? cameraStatusesRaw ?? []) as any[];

  const { data: captureModesRaw } = useQuery({
    queryKey: ['masterdata-capture-modes'],
    queryFn: () => imageServiceApi.getMasterdata({ type: 'capture_mode' }, { silent403: true }),
    staleTime: 1000 * 60 * 5,
    enabled: hasMasterdataPermission,
  });
  const captureModes = (captureModesRaw?.data ?? captureModesRaw ?? []) as any[];

  const { data: viewpointsRaw } = useQuery({
    queryKey: ['masterdata-image-viewpoints'],
    queryFn: () => imageServiceApi.getMasterdata({ type: 'image_viewpoint' }, { silent403: true }),
    staleTime: 1000 * 60 * 5,
    enabled: hasMasterdataPermission,
  });
  const viewpoints = (viewpointsRaw?.data ?? viewpointsRaw ?? []) as any[];

  const { data: templates = [] } = useQuery({
    queryKey: ['camera-templates'],
    queryFn: () => imageServiceApi.getCameraTemplates(),
    staleTime: 1000 * 60 * 5,
  });

  const handleSort = (col: string) => {
    if (col === 'actions' || col === 'no') return;
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const getUniqueCloneName = (originalName: string, extraExistingNames?: Set<string>) => {
    let candidate = `${originalName} Copy`;
    let counter = 1;
    const isDup = (name: string) => {
      const lower = name.trim().toLowerCase();
      const inCurrent = cameras.some((c: any) => c.name.trim().toLowerCase() === lower);
      const inExtra = extraExistingNames ? extraExistingNames.has(lower) : false;
      return inCurrent || inExtra;
    };
    while (isDup(candidate)) {
      counter++;
      candidate = `${originalName} Copy ${counter}`;
    }
    return candidate;
  };

  const handleTemplateChange = (templateId: string) => {
    const tpl = templates.find((t: any) => t.id === templateId);
    setForm(p => ({
      ...p,
      templateId,
      ...(tpl ? {
        retentionPolicyId: tpl.retentionPolicyId || p.retentionPolicyId,
        pollIntervalSeconds: tpl.pollIntervalSeconds || p.pollIntervalSeconds,
        captureMode: tpl.captureMode || p.captureMode,
      } : {})
    }));
  };

  const handleIpChange = (newIp: string) => {
    setForm(p => {
      let newSmbPath = p.smbSharePath;
      const previousIp = p.ipAddress;
      const currentPath = p.smbSharePath;
      
      const isDefaultOrEmpty = !currentPath || 
        currentPath === `//${previousIp}/` || 
        (previousIp && currentPath.startsWith(`//${previousIp}/`));
        
      if (isDefaultOrEmpty) {
        if (newIp) {
          if (previousIp && currentPath.startsWith(`//${previousIp}/`)) {
            const suffix = currentPath.slice(`//${previousIp}/`.length);
            newSmbPath = `//${newIp}/${suffix}`;
          } else {
            newSmbPath = `//${newIp}/`;
          }
        } else {
          newSmbPath = '';
        }
      }
      return { ...p, ipAddress: newIp, smbSharePath: newSmbPath };
    });
  };

  const openCreate = () => {
    const defaultTemplate = templates.find((t: any) => t.isDefault && t.isActive);
    const defaultCameraType = cameraTypes.find((ct: any) => ct.isDefault && ct.isActive);
    const formInit = emptyForm();
    if (defaultCameraType) {
      formInit.cameraTypeCode = defaultCameraType.code;
    }
    if (defaultTemplate) {
      formInit.templateId = defaultTemplate.id;
      if (defaultTemplate.retentionPolicyId) {
        formInit.retentionPolicyId = defaultTemplate.retentionPolicyId;
      }
      if (defaultTemplate.pollIntervalSeconds) {
        formInit.pollIntervalSeconds = defaultTemplate.pollIntervalSeconds;
      }
      if (defaultTemplate.captureMode) {
        formInit.captureMode = defaultTemplate.captureMode;
      }
    }
    const defaultRetention = policies.find((rp: any) => rp.isDefault);
    if (defaultRetention) {
      formInit.retentionPolicyId = defaultRetention.id;
    }
    setForm(formInit);
    setModal({ open: true, item: null });
  };
  const openEdit = (item: any) => {
    const ov = item.overrides ?? {};
    setForm({
      name: item.name, ipAddress: item.ipAddress, smbSharePath: item.smbSharePath,
      smbDomain: item.smbDomain ?? '', smbUsername: item.smbUsername,
      smbPasswordEncrypted: '', pollIntervalSeconds: item.pollIntervalSeconds,
      captureMode: item.captureMode, cameraTypeCode: item.cameraTypeCode ?? '', viewpointCode: item.viewpointCode ?? '',
      retentionPolicyId: item.retentionPolicyId, description: item.description ?? '',
      templateId: item.templateId ?? '',
      acceptedExtensions: Array.isArray(ov.acceptedExtensions) ? ov.acceptedExtensions : [],
      convertToPng: boolToTri(ov.convertToPng),
      keepSmaller: boolToTri(ov.keepSmaller),
      generateThumbnail: boolToTri(ov.generateThumbnail),
      thumbnailSize: ov.thumbnailSize != null ? String(ov.thumbnailSize) : '',
      compressionQuality: ov.compressionQuality != null ? String(ov.compressionQuality) : '',
      slaTargetPercent: item.slaTargetPercent != null ? String(item.slaTargetPercent) : '',
    });
    setModal({ open: true, item });
  };

  const openClone = (item: any) => {
    const ov = item.overrides ?? {};
    const uniqueName = getUniqueCloneName(item.name);
    setForm({
      name: uniqueName, ipAddress: item.ipAddress, smbSharePath: item.smbSharePath,
      smbDomain: item.smbDomain ?? '', smbUsername: item.smbUsername,
      smbPasswordEncrypted: item.smbPasswordEncrypted ?? '', pollIntervalSeconds: item.pollIntervalSeconds,
      captureMode: item.captureMode, cameraTypeCode: item.cameraTypeCode ?? '', viewpointCode: item.viewpointCode ?? '',
      retentionPolicyId: item.retentionPolicyId, description: item.description ?? '',
      templateId: item.templateId ?? '',
      acceptedExtensions: Array.isArray(ov.acceptedExtensions) ? ov.acceptedExtensions : [],
      convertToPng: boolToTri(ov.convertToPng),
      keepSmaller: boolToTri(ov.keepSmaller),
      generateThumbnail: boolToTri(ov.generateThumbnail),
      thumbnailSize: ov.thumbnailSize != null ? String(ov.thumbnailSize) : '',
      compressionQuality: ov.compressionQuality != null ? String(ov.compressionQuality) : '',
      slaTargetPercent: item.slaTargetPercent != null ? String(item.slaTargetPercent) : '',
    });
    setModal({ open: true, item: null });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.ipAddress || !form.smbSharePath || !form.smbUsername || !form.retentionPolicyId) {
      toast.warning(t('common.requiredFields')); return;
    }
    const isNameDuplicate = cameras.some((c: any) => c.id !== modal.item?.id && c.name.trim().toLowerCase() === form.name.trim().toLowerCase());
    if (isNameDuplicate) {
      toast.error(t('imageService.cameras.validation.nameDuplicateError'));
      return;
    }
    // Enforce admin-configured required fields for the camera form (only fields
    // that have an input in this modal; smbPassword is skipped on edit since it
    // is intentionally left blank to keep the existing value).
    const cameraFormKeys = ['name', 'ipAddress', 'smbSharePath', 'smbUsername',
      'smbPasswordEncrypted', 'cameraTypeCode', 'captureMode', 'pollIntervalSeconds', 'retentionPolicyId', 'templateId', 'description'];
    for (const fd of catalogFieldsFor('camera')) {
      if (!cameraFormKeys.includes(fd.key) || !isCameraFieldRequired(fd.key)) continue;
      if (modal.item && fd.key === 'smbPasswordEncrypted') continue;
      const val = (form as any)[fd.key];
      const empty = val === undefined || val === null
        || (typeof val === 'string' && val.trim() === '')
        || (Array.isArray(val) && val.length === 0);
      if (empty) { toast.warning(t('imageService.requiredFields.missingField', { field: t(fd.labelKey) })); return; }
    }
    try {
      setSubmitting(true);
      // Build payload, mapping tri-state override fields back to nullable values.
      const buildPayload = () => {
        const {
          convertToPng, keepSmaller, generateThumbnail,
          thumbnailSize, compressionQuality, acceptedExtensions, templateId, slaTargetPercent,
          ...rest
        } = form as any;
        return {
          ...rest,
          templateId: templateId || null,
          acceptedExtensions: Array.isArray(acceptedExtensions) ? acceptedExtensions : [],
          convertToPng: triToPayload(convertToPng),
          keepSmaller: triToPayload(keepSmaller),
          generateThumbnail: triToPayload(generateThumbnail),
          thumbnailSize: thumbnailSize === '' ? null : parseInt(thumbnailSize, 10),
          compressionQuality: compressionQuality === '' ? null : parseInt(compressionQuality, 10),
          slaTargetPercent: slaTargetPercent === '' ? null : parseFloat(slaTargetPercent),
        };
      };
      if (modal.item) {
        const payload: any = buildPayload();
        if (!payload.smbPasswordEncrypted) delete payload.smbPasswordEncrypted;
        if (!payload.smbDomain) delete payload.smbDomain;
        await imageServiceApi.updateCamera(modal.item.id, payload);
        toast.success(t('imageService.cameras.updated'));
      } else {
        await imageServiceApi.createCamera(buildPayload());
        toast.success(t('imageService.cameras.created'));
      }
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      setModal({ open: false });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally { setSubmitting(false); }
  };

  const handleDeactivate = async (id: string) => {
    try {
      await imageServiceApi.deactivateCamera(id);
      toast.success(t('imageService.cameras.deactivated'));
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || !bulkDeletePassword) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      let successCount = 0;
      for (const id of ids) {
        try {
          await imageServiceApi.deleteCamera(id, bulkDeletePassword);
          successCount++;
        } catch (e: any) {
          if (e?.response?.status === 401) {
            toast.error(t('imageService.cameras.wrongPassword'));
            setBulkDeleting(false);
            return;
          }
        }
      }
      toast.success(t('imageService.cameras.deleteBulkSuccess', { count: successCount }));
      setSelectedIds(new Set());
      setBulkDeleteModal({ open: false });
      setBulkDeletePassword('');
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'));
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkClone = async () => {
    if (selectedIds.size === 0) return;
    setBulkCloning(true);
    try {
      const ids = Array.from(selectedIds);
      let successCount = 0;
      const newlyCreatedNames = new Set<string>();
      for (const id of ids) {
        const item = cameras.find((c: any) => c.id === id);
        if (!item) continue;
        const ov = item.overrides ?? {};
        const uniqueName = getUniqueCloneName(item.name, newlyCreatedNames);
        newlyCreatedNames.add(uniqueName.trim().toLowerCase());
        const payload = {
          name: uniqueName,
          ipAddress: item.ipAddress,
          smbSharePath: item.smbSharePath,
          smbDomain: item.smbDomain ?? '',
          smbUsername: item.smbUsername,
          smbPasswordEncrypted: item.smbPasswordEncrypted ?? '',
          pollIntervalSeconds: item.pollIntervalSeconds,
          captureMode: item.captureMode,
          cameraTypeCode: item.cameraTypeCode ?? '',
          viewpointCode: item.viewpointCode ?? '',
          retentionPolicyId: item.retentionPolicyId,
          description: item.description ?? '',
          templateId: item.templateId || null,
          acceptedExtensions: Array.isArray(ov.acceptedExtensions) ? ov.acceptedExtensions : [],
          convertToPng: ov.convertToPng !== undefined ? ov.convertToPng : null,
          keepSmaller: ov.keepSmaller !== undefined ? ov.keepSmaller : null,
          generateThumbnail: ov.generateThumbnail !== undefined ? ov.generateThumbnail : null,
          thumbnailSize: ov.thumbnailSize != null ? parseInt(ov.thumbnailSize, 10) : null,
          compressionQuality: ov.compressionQuality != null ? parseInt(ov.compressionQuality, 10) : null,
          slaTargetPercent: item.slaTargetPercent != null ? parseFloat(item.slaTargetPercent) : null,
        };
        await imageServiceApi.createCamera(payload);
        successCount++;
      }
      toast.success(t('imageService.cameras.createdBulk', { count: successCount }));
      setSelectedIds(new Set());
      setBulkCloneModal({ open: false });
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'));
    } finally {
      setBulkCloning(false);
    }
  };

  const openDeleteModal = (camera: any) => {
    setDeletePassword('');
    setDeleteModal({ open: true, camera });
  };

  const handleDeleteCamera = useCallback(async () => {
    if (!deleteModal.camera || !deletePassword) return;
    setDeleting(true);
    try {
      await imageServiceApi.deleteCamera(deleteModal.camera.id, deletePassword);
      toast.success(t('imageService.cameras.deleteCameraSuccess'));
      setDeleteModal({ open: false });
      setDeletePassword('');
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) {
      if (e?.response?.status === 401) {
        toast.error(t('imageService.cameras.wrongPassword'));
      } else if (!e?._handled) {
        toast.error(t('common.error'));
      }
    } finally { setDeleting(false); }
  }, [deleteModal.camera, deletePassword, t, toast, queryClient]);

  const fetchCameraTrash = useCallback(async () => {
    setTrashLoading(true);
    try {
      const result = await imageServiceApi.getDeletedCameras();
      setTrashData(result);
      setTrashSelected(new Set());
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally { setTrashLoading(false); }
  }, [t, toast]);

  const handleTrashSelectToggle = useCallback((id: string) => {
    setTrashSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleTrashSelectAllToggle = useCallback(() => {
    if (pagedTrashData.length === 0) return;
    setTrashSelected(prev => {
      const allSelected = pagedTrashData.every((item: any) => prev.has(item.id));
      const next = new Set(prev);
      if (allSelected) {
        pagedTrashData.forEach((item: any) => next.delete(item.id));
      } else {
        pagedTrashData.forEach((item: any) => next.add(item.id));
      }
      return next;
    });
  }, [pagedTrashData]);

  const handleRestoreSelectedCameraTrash = useCallback(async () => {
    if (trashSelected.size === 0) return;
    setTrashBulkRestoring(true);
    try {
      const ids = Array.from(trashSelected);
      for (const id of ids) {
        await imageServiceApi.restoreCamera(id);
      }
      toast.success(t('imageService.cameras.restoreCameraSuccess'));
      fetchCameraTrash();
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'));
      fetchCameraTrash();
    } finally { setTrashBulkRestoring(false); }
  }, [trashSelected, t, toast, queryClient, fetchCameraTrash]);

  const handleDeleteSelectedCameraTrashPermanently = useCallback(async () => {
    if (trashSelected.size === 0 || !bulkDeleteTrashPassword) return;
    setTrashBulkDeleting(true);
    try {
      const ids = Array.from(trashSelected);
      for (const id of ids) {
        await imageServiceApi.deleteCameraPermanent(id, bulkDeleteTrashPassword);
      }
      toast.success(t('imageService.cameras.permanentDeleteCameraSuccess'));
      setShowBulkDeleteTrashConfirm(false);
      setBulkDeleteTrashPassword('');
      fetchCameraTrash();
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) {
      if (e?.response?.status === 401) {
        toast.error(t('imageService.cameras.wrongPassword'));
      } else if (!e?._handled) {
        toast.error(t('common.error'));
      }
      fetchCameraTrash();
    } finally { setTrashBulkDeleting(false); }
  }, [trashSelected, bulkDeleteTrashPassword, t, toast, queryClient, fetchCameraTrash]);

  const handleOpenCameraTrash = useCallback(() => {
    setTrashOpen(true);
    setShowEmptyConfirm(false);
    setEmptyTrashPassword('');
    setPermaDeleteTarget(null);
    setPermaDeletePassword('');
    setTrashQ('');
    setTrashStartDate('');
    setTrashEndDate('');
    setTrashPage(1);
    setTrashSelected(new Set());
    setShowBulkDeleteTrashConfirm(false);
    setBulkDeleteTrashPassword('');
    fetchCameraTrash();
  }, [fetchCameraTrash]);

  const handleRestoreCamera = useCallback(async (id: string) => {
    try {
      await imageServiceApi.restoreCamera(id);
      toast.success(t('imageService.cameras.restoreCameraSuccess'));
      fetchCameraTrash();
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
  }, [t, toast, queryClient, fetchCameraTrash]);

  const handleRestoreAllCameraTrash = useCallback(async () => {
    if (filteredTrashData.length === 0) return;
    setRestoringAllTrash(true);
    try {
      for (const item of filteredTrashData) {
        await imageServiceApi.restoreCamera(item.id);
      }
      toast.success(t('imageService.cameras.restoreCameraSuccess'));
      fetchCameraTrash();
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) {
      if (!e?._handled) toast.error(t('common.error'));
      fetchCameraTrash();
    } finally { setRestoringAllTrash(false); }
  }, [filteredTrashData, t, toast, queryClient, fetchCameraTrash]);

  const handleEmptyCameraTrash = useCallback(async () => {
    if (!emptyTrashPassword) return;
    try {
      const result = await imageServiceApi.emptyCameraTrash(emptyTrashPassword);
      toast.success(t('imageService.cameras.emptyCameraTrashSuccess', { count: result.deleted }));
      setShowEmptyConfirm(false);
      setEmptyTrashPassword('');
      fetchCameraTrash();
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) {
      if (e?.response?.status === 401) {
        toast.error(t('imageService.cameras.wrongPassword'));
      } else if (!e?._handled) {
        toast.error(t('common.error'));
      }
    }
  }, [emptyTrashPassword, t, toast, queryClient, fetchCameraTrash]);

  const handlePermanentDeleteCamera = useCallback(async () => {
    if (!permaDeleteTarget || !permaDeletePassword) return;
    setPermaDeleting(true);
    try {
      await imageServiceApi.deleteCameraPermanent(permaDeleteTarget.id, permaDeletePassword);
      toast.success(t('imageService.cameras.permanentDeleteCameraSuccess'));
      setPermaDeleteTarget(null);
      setPermaDeletePassword('');
      fetchCameraTrash();
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
    } catch (e: any) {
      if (e?.response?.status === 401) {
        toast.error(t('imageService.cameras.wrongPassword'));
      } else if (!e?._handled) {
        toast.error(t('common.error'));
      }
    } finally { setPermaDeleting(false); }
  }, [permaDeleteTarget, permaDeletePassword, t, toast, queryClient, fetchCameraTrash]);

  const [changingStatus, setChangingStatus] = useState<Set<string>>(new Set());

  // Status Change Dialog state
  const [statusDialog, setStatusDialog] = useState<{ open: boolean; camera?: any }>({ open: false });
  const [statusForm, setStatusForm] = useState<any>({
    status: '', reason: '', description: '', problemDesc: '', resolutionDesc: '',
    rootCause: '', estimatedFinish: '', priority: 'medium', impact: 'none',
    assignedTo: '', assignedToType: 'user', assignedToOther: '', observers: [] as string[],
  });
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
  const [attachDragOver, setAttachDragOver] = useState(false);

  // Resolution Dialog state
  const [resolveDialog, setResolveDialog] = useState<{ open: boolean; camera?: any }>({ open: false });
  const [resolveForm, setResolveForm] = useState({ resolution: '', rootCause: '', correctiveAction: '', preventiveAction: '', resolutionDesc: '' });

  // Fetch incident options from masterdata
  const { data: incidentOptions } = useQuery({
    queryKey: ['incident-options'],
    queryFn: () => imageServiceApi.getIncidentOptions({ silent403: true }),
    staleTime: 1000 * 60 * 5,
  });

  // Fetch users for assignment/observers
  const { data: usersRaw } = useQuery({
    queryKey: ['users-list-incident'],
    queryFn: () => imageServiceApi.getUsers({ page: 1, limit: 100 }, { silent403: true }),
    staleTime: 1000 * 60 * 5,
    enabled: statusDialog.open && hasUsersPermission,
  });
  const users = (usersRaw?.data ?? usersRaw ?? []) as any[];

  const STATUS_ICON_MAP: Record<string, any> = { active: Wifi, inactive: WifiOff, maintenance: Wrench, error: AlertTriangle };
  const STATUS_BG_MAP: Record<string, string> = { active: 'bg-green-500/20 text-green-400', inactive: 'bg-gray-500/20 text-gray-400', maintenance: 'bg-yellow-500/20 text-yellow-400', error: 'bg-red-500/20 text-red-400' };
  const STATUS_RADIO_OPTIONS = cameraStatuses.length > 0
    ? cameraStatuses.filter((s: any) => s.isActive).map((s: any) => ({
        value: s.code,
        label: getLocalizedValue(s, i18n.language),
        bg: STATUS_BG_MAP[s.code] ?? 'bg-purple-500/20 text-purple-400',
        icon: STATUS_ICON_MAP[s.code] ?? Activity,
      }))
    : [
        { value: 'active', label: t('imageService.cameras.statusActive', 'Online'), bg: 'bg-green-500/20 text-green-400', icon: Wifi },
        { value: 'maintenance', label: t('imageService.cameras.statusMaintenance', 'Maintenance'), bg: 'bg-yellow-500/20 text-yellow-400', icon: Wrench },
        { value: 'inactive', label: t('imageService.cameras.statusInactive', 'Offline'), bg: 'bg-gray-500/20 text-gray-400', icon: WifiOff },
        { value: 'error', label: t('imageService.cameras.statusError', 'Error'), bg: 'bg-red-500/20 text-red-400', icon: AlertTriangle },
      ];

  const openStatusDialog = (camera: any) => {
    // Always open the status dialog to choose new status
    const currentUserName = user?.username || '';
    setStatusForm({
      status: '', reason: '', description: '', problemDesc: '', resolutionDesc: '',
      rootCause: '', estimatedFinish: '', priority: 'medium', impact: 'none',
      assignedTo: hasUsersPermission ? '' : currentUserName,
      assignedToType: hasUsersPermission ? currentUserName : 'user',
      assignedToOther: '',
      observers: [] as string[],
    });
    setAttachmentFiles([]);
    setAttachmentPreviews([]);
    setStatusDialog({ open: true, camera });
  };

  const handleAttachFiles = (files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    const remaining = 3 - attachmentFiles.length;
    if (remaining <= 0) { toast.warning(t('imageService.incidents.attachMaxFiles')); return; }
    const toAdd = imageFiles.slice(0, remaining);
    const newPreviews = toAdd.map(f => URL.createObjectURL(f));
    setAttachmentFiles(prev => [...prev, ...toAdd]);
    setAttachmentPreviews(prev => [...prev, ...newPreviews]);
  };

  const handleRemoveAttachment = (idx: number) => {
    URL.revokeObjectURL(attachmentPreviews[idx]);
    setAttachmentFiles(prev => prev.filter((_, i) => i !== idx));
    setAttachmentPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const handleStatusDialogConfirm = async () => {
    const camera = statusDialog.camera;
    if (!camera || !statusForm.status) return;

    // If going to active, show resolution dialog instead
    if (statusForm.status === 'active' && camera.status !== 'active') {
      setStatusDialog({ open: false });
      setResolveForm({ resolution: '', rootCause: '', correctiveAction: '', preventiveAction: '', resolutionDesc: '' });
      setResolveDialog({ open: true, camera });
      return;
    }

    // Going to non-active status: require reason
    if (statusForm.status !== 'active' && !statusForm.reason) {
      toast.warning(t('imageService.incidents.reasonRequired'));
      return;
    }

    // Enforce admin-configured required incident fields (status-change dialog).
    if (statusForm.status !== 'active') {
      const assignee = hasUsersPermission
        ? (statusForm.assignedToType === 'other' ? statusForm.assignedToOther : statusForm.assignedToType)
        : statusForm.assignedTo;
      const incidentVals: Record<string, any> = {
        reason: statusForm.reason,
        problemDesc: statusForm.problemDesc,
        priority: statusForm.priority,
        impact: statusForm.impact,
        assignedTo: assignee,
        attachments: attachmentFiles.length,
      };
      // estimatedFinish input is only shown for maintenance/inactive statuses.
      if (statusForm.status === 'maintenance' || statusForm.status === 'inactive') {
        incidentVals.estimatedFinish = statusForm.estimatedFinish;
      }
      for (const fd of catalogFieldsFor('incident')) {
        if (!(fd.key in incidentVals) || !isIncidentFieldRequired(fd.key)) continue;
        const val = incidentVals[fd.key];
        const empty = val === undefined || val === null
          || (typeof val === 'string' && val.trim() === '')
          || (fd.key === 'attachments' && !val);
        if (empty) { toast.warning(t('imageService.requiredFields.missingField', { field: t(fd.labelKey) })); return; }
      }
    }

    setChangingStatus(prev => new Set(prev).add(camera.id));
    setStatusDialog({ open: false });
    const filesToUpload = [...attachmentFiles];
    setAttachmentFiles([]);
    setAttachmentPreviews(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
    try {
      const finalAssignee = hasUsersPermission
        ? (statusForm.assignedToType === 'other' ? statusForm.assignedToOther : statusForm.assignedToType)
        : statusForm.assignedTo;
      const result = await imageServiceApi.updateCamera(camera.id, {
        status: statusForm.status,
        reason: statusForm.reason,
        incidentDescription: statusForm.description,
        problemDesc: statusForm.problemDesc || undefined,
        rootCause: statusForm.rootCause || undefined,
        estimatedFinish: statusForm.estimatedFinish || undefined,
        priority: statusForm.priority,
        impact: statusForm.impact,
        assignedTo: finalAssignee || undefined,
        observers: statusForm.observers,
      });
      // Upload attachments if any — find created incident id from recent incidents
      if (filesToUpload.length > 0) {
        try {
          const incidents = await imageServiceApi.getIncidents({ cameraId: camera.id, status: 'open', limit: 1 });
          const incidentId = incidents?.data?.[0]?.id;
          if (incidentId) {
            await Promise.all(filesToUpload.map(f => imageServiceApi.uploadIncidentAttachment(incidentId, f)));
          }
        } catch { /* non-fatal: attachment upload failure */ }
      }
      toast.success(t('imageService.incidents.incidentCreated'));
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-open-incidents-count'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally {
      setChangingStatus(prev => { const next = new Set(prev); next.delete(camera.id); return next; });
    }
  };

  const handleResolveConfirm = async () => {
    const camera = resolveDialog.camera;
    if (!camera) return;

    setChangingStatus(prev => new Set(prev).add(camera.id));
    setResolveDialog({ open: false });
    try {
      await imageServiceApi.updateCamera(camera.id, {
        status: 'active',
        resolution: resolveForm.resolution || undefined,
        rootCause: resolveForm.rootCause || undefined,
        correctiveAction: resolveForm.correctiveAction || undefined,
        preventiveAction: resolveForm.preventiveAction || undefined,
        resolutionDesc: resolveForm.resolutionDesc || undefined,
      });
      toast.success(t('imageService.incidents.incidentResolved'));
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-open-incidents-count'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally {
      setChangingStatus(prev => { const next = new Set(prev); next.delete(camera.id); return next; });
    }
  };

  const [scanning, setScanning] = useState(false);
  const [scanningCameras, setScanningCameras] = useState<Set<string>>(new Set());

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const res = await imageServiceApi.scanNow();
      if (res?.offlineCount > 0) {
        toast.warning(t('imageService.cameras.scanTriggeredSomeOffline', { count: res.offlineCount }));
      } else {
        toast.success(t('imageService.cameras.scanTriggered'));
      }
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['cameras-list'] }), 3000);
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally { setScanning(false); }
  };

  const handleScanCamera = async (id: string) => {
    setScanningCameras(prev => new Set(prev).add(id));
    try {
      const res = await imageServiceApi.scanCamera(id);
      if (res?.warning === 'camera_offline') {
        toast.warning(t('imageService.cameras.scanTriggeredOffline'));
      } else {
        toast.success(t('imageService.cameras.scanTriggered'));
      }
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['cameras-list'] }), 3000);
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally {
      setScanningCameras(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const handleTestConnection = async () => {
    if (!form.smbSharePath || !form.smbUsername) { toast.warning(t('common.requiredFields')); return; }
    setTestResult({ loading: true });
    try {
      const res = await imageServiceApi.testSmbConnection({
        smbSharePath: form.smbSharePath,
        smbUsername: form.smbUsername,
        smbPasswordEncrypted: form.smbPasswordEncrypted,
        smbDomain: form.smbDomain || undefined,
      });
      const message = translateSmbTestResult(res, t);
      setTestResult({ loading: false, success: res.success, message });
      if (res.success) toast.success(message);
      else toast.error(message);
    } catch {
      setTestResult({ loading: false, success: false, message: t('imageService.cameras.smbError.unknown', { detail: t('common.error') }) });
      toast.error(t('common.error'));
    }
  };

  const openBrowse = async () => {
    if (!form.ipAddress || !form.smbUsername) { toast.warning(t('common.requiredFields')); return; }
    setBrowseOpen(true);
    if (form.smbSharePath) {
      setBrowseStep('files');
      setBrowsePath('');
      setBrowseLoading(true);
      try {
        const parts = form.smbSharePath.replace(/^\/\//, '').split('/');
        const share = parts[1];
        const subPath = parts.slice(2).join('/');
        const res = await imageServiceApi.browseSmb({
          smbSharePath: form.smbSharePath,
          smbUsername: form.smbUsername,
          smbPasswordEncrypted: form.smbPasswordEncrypted,
          smbDomain: form.smbDomain || undefined,
          path: subPath || undefined,
        });
        setBrowseItems(res.entries ?? []);
        setBrowsePath(parts.slice(1).join('/') + '/');
      } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
      finally { setBrowseLoading(false); }
    } else {
      setBrowseStep('shares');
      setBrowseLoading(true);
      try {
        const res = await imageServiceApi.listSmbShares({
          host: form.ipAddress,
          smbUsername: form.smbUsername,
          smbPasswordEncrypted: form.smbPasswordEncrypted,
          smbDomain: form.smbDomain || undefined,
        });
        setBrowseShares(res.shares ?? []);
      } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
      finally { setBrowseLoading(false); }
    }
  };

  const browseShare = async (share: string) => {
    const path = `//${form.ipAddress}/${share}`;
    setBrowseStep('files');
    setBrowsePath('');
    setBrowseLoading(true);
    try {
      const res = await imageServiceApi.browseSmb({
        smbSharePath: path,
        smbUsername: form.smbUsername,
        smbPasswordEncrypted: form.smbPasswordEncrypted,
        smbDomain: form.smbDomain || undefined,
      });
      setBrowseItems(res.entries ?? []);
      setBrowsePath(share + '/');
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally { setBrowseLoading(false); }
  };

  const browseFolder = async (folder: string) => {
    const parts = browsePath.split('/').filter(Boolean);
    const newPath = [...parts, folder].join('/');
    const share = parts[0];
    const subPath = parts.slice(1).concat(folder).join('/');
    setBrowseLoading(true);
    try {
      const res = await imageServiceApi.browseSmb({
        smbSharePath: `//${form.ipAddress}/${share}`,
        smbUsername: form.smbUsername,
        smbPasswordEncrypted: form.smbPasswordEncrypted,
        smbDomain: form.smbDomain || undefined,
        path: subPath,
      });
      setBrowseItems(res.entries ?? []);
      setBrowsePath(newPath + '/');
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally { setBrowseLoading(false); }
  };

  const selectBrowsePath = (folder: string) => {
    const share = browsePath.split('/').filter(Boolean)[0];
    const subPath = browsePath.endsWith('/') ? browsePath.slice(0, -1) : browsePath;
    const fullPath = subPath.split('/').slice(1).join('/');
    const smbPath = fullPath ? `//${form.ipAddress}/${share}/${fullPath}` : `//${form.ipAddress}/${share}`;
    setForm(p => ({ ...p, smbSharePath: smbPath }));
    setBrowseOpen(false);
  };

  const goBackShares = () => {
    setBrowseStep('shares');
    setBrowseItems([]);
    setBrowsePath('');
  };

  const filtered = cameras.filter((c: any) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()));

  const getSortValue = (camera: any, col: string) => {
    switch (col) {
      case 'cameraType':
        return camera.cameraTypeCode ?? '';
      case 'retentionPolicy': {
        const p = (policies as any[]).find((rp: any) => rp.id === camera.retentionPolicyId);
        return p?.name ?? '';
      }
      case 'lastPoll':
        return camera.lastPolledAt ?? '';
      case 'totalImages':
        return Number(camera.totalImagesCount ?? 0);
      case 'dateAdded':
        return camera.createdAt ?? '';
      default:
        return camera[col] ?? '';
    }
  };

  const sorted = [...filtered].sort((a: any, b: any) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const av = getSortValue(a, sortCol);
    const bv = getSortValue(b, sortCol);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });

  const totalItems = sorted.length;
  const totalPages = Math.ceil(totalItems / limit);
  const paginated = sorted.slice((page - 1) * limit, page * limit);

  const thCls = (col: string) =>
    `px-4 py-3 text-left text-sm font-semibold cursor-pointer select-none hover:text-cyan-300 ${themeConfig.text.primary}`;

  const cameraExportData = useMemo(() => sorted.map((camera: any, idx: number) => ({
    no: idx + 1,
    name: camera.name,
    ipAddress: camera.ipAddress,
    status: camera.status,
    lastPolledAt: camera.lastPolledAt ? new Date(camera.lastPolledAt).toLocaleString() : '-',
    totalImages: Number(camera.totalImagesCount ?? 0),
    createdAt: camera.createdAt ? formatDateTime(camera.createdAt, i18n.language) : '-',
    createdBy: camera.createdBy || '-',
  })), [sorted, i18n.language]);

  const cameraExportColumns = [
    { key: 'no', label: '#' },
    { key: 'name', label: t('imageService.cameras.cameraName') },
    { key: 'ipAddress', label: t('imageService.cameras.ipAddress') },
    { key: 'status', label: t('imageService.cameras.status') },
    { key: 'lastPolledAt', label: t('imageService.cameras.lastPoll') },
    { key: 'totalImages', label: t('imageService.cameras.totalImages') },
    { key: 'createdAt', label: t('imageService.cameras.dateAdded') },
    { key: 'createdBy', label: t('imageService.cameras.createdBy') },
  ];

  const isNameDuplicate = form.name ? cameras.some((c: any) => c.id !== modal.item?.id && c.name.trim().toLowerCase() === form.name.trim().toLowerCase()) : false;
  const ipDupCamera = form.ipAddress ? cameras.find((c: any) => c.id !== modal.item?.id && c.ipAddress.trim() === form.ipAddress.trim()) : null;
  const smbDupCamera = form.smbSharePath ? cameras.find((c: any) => c.id !== modal.item?.id && c.smbSharePath.trim().toLowerCase() === form.smbSharePath.trim().toLowerCase()) : null;

  return (
    <div className="pt-6 px-6 pb-2.5">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            iSmart CCTV · {t('imageService.cameras.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.cameras.title')}</h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.cameras.subtitle')}</p>
        </div>
        <ExportButton
          filename="camera-list"
          title={t('imageService.cameras.title')}
          sections={[
            { title: t('imageService.cameras.title'), columns: cameraExportColumns, data: cameraExportData },
            { title: t('imageService.cameras.cameraInfo'), columns: [
              { key: 'label', label: t('ui.imageServiceCameras.metric') }, { key: 'value', label: t('ui.imageServiceCameras.value') },
            ], data: (() => {
              const total = sorted.length;
              const active = sorted.filter((c: any) => c.status === 'active').length;
              const maint = sorted.filter((c: any) => c.status === 'maintenance').length;
              const inactive = sorted.filter((c: any) => c.status === 'inactive').length;
              const error = sorted.filter((c: any) => c.status === 'error').length;
              return [
                { label: t('imageService.cameras.totalImages'), value: String(total) },
                { label: t('imageService.cameras.active'), value: `${active} (${total ? ((active/total)*100).toFixed(0) : 0}%)` },
                { label: t('imageService.cameras.maintenance'), value: `${maint}` },
                { label: t('imageService.cameras.inactive'), value: `${inactive}` },
                { label: t('imageService.cameras.error'), value: `${error}` },
              ];
            })() },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${themeConfig.text.secondary}`} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className={`pl-8 pr-3 py-1.5 rounded-lg text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} w-52`} />
          </div>
          <div className="w-36">
            <SearchableSelect value={statusFilter} onChange={setStatusFilter}
              placeholder={t('imageService.search.allStatus')}
              options={cameraStatuses.filter((s: any) => s.isActive).length > 0
                ? cameraStatuses.filter((s: any) => s.isActive).map((s: any) => ({ value: s.code, label: getLocalizedValue(s, i18n.language) }))
                : ['active', 'inactive', 'error', 'maintenance'].map(s => ({ value: s, label: t(`imageService.cameras.${s}`) }))
              } />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-cyan-950/40 border border-cyan-800/40">
              <span className={`text-xs mr-1 font-medium ${themeConfig.text.primary}`}>
                {t('imageService.cameras.selectedCount', { count: selectedIds.size })}
              </span>
              <Button size="sm" onClick={() => setBulkCloneModal({ open: true })}>
                <Copy size={12} className="mr-1" /> {t('imageService.cameras.bulkClone')}
              </Button>
              {canDelete && (
                <Button size="sm" variant="destructive" onClick={() => setBulkDeleteModal({ open: true })}>
                  <Trash2 size={12} className="mr-1" /> {t('imageService.cameras.bulkDelete')}
                </Button>
              )}
              <button onClick={() => setSelectedIds(new Set())} className={`text-xs hover:underline ml-1 ${themeConfig.text.secondary}`}>
                {t('imageService.search.clearSelection')}
              </button>
            </div>
          ) : (
            <>
              <Button onClick={openCreate}>
                <Plus size={16} className="mr-1.5" /> {t('imageService.cameras.newCamera')}
              </Button>
              <Button variant="secondary" onClick={handleScanNow} disabled={scanning}>
                <RefreshCw size={16} className={`mr-1.5 ${scanning ? 'animate-spin' : ''}`} />
                {t('imageService.cameras.scanNow')}
              </Button>
              {canDelete && (
                <button onClick={handleOpenCameraTrash}
                  className="px-3 py-2 rounded-md text-xs flex items-center gap-1.5 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">
                  <Trash2 size={13} /> {t('imageService.cameras.cameraTrash')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div ref={contentRef}>
      {isLoading ? <TableSkeleton rows={8} /> : (
        <div className={`${themeConfig.card} rounded-lg overflow-hidden flex flex-col mb-2`}>
          <div className="overflow-x-auto overflow-y-auto relative" style={{ height: 'calc(100vh - 385px)', maxHeight: 'calc(100vh - 385px)' }}>
            <table className="w-full relative border-collapse">
              <thead className={`${themeConfig.tableHeader} sticky top-0 z-10 shadow-sm`}>
              <tr>
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={sorted.length > 0 && selectedIds.size === sorted.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(sorted.map(c => c.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    className="w-4 h-4 rounded accent-cyan-500 cursor-pointer"
                  />
                </th>
                <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>#</th>
                <th onClick={() => handleSort('name')} className={thCls('name')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.cameraName')}
                    {sortCol === 'name' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                <th onClick={() => handleSort('ipAddress')} className={thCls('ipAddress')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.ipAddress')}
                    {sortCol === 'ipAddress' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                <th onClick={() => handleSort('cameraType')} className={thCls('cameraType')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.cameraType')}
                    {sortCol === 'cameraType' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                <th onClick={() => handleSort('retentionPolicy')} className={thCls('retentionPolicy')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.retentionPolicy')}
                    {sortCol === 'retentionPolicy' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                <th onClick={() => handleSort('status')} className={thCls('status')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.status')}
                    {sortCol === 'status' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                <th onClick={() => handleSort('lastPoll')} className={thCls('lastPoll')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.lastPoll')}
                    {sortCol === 'lastPoll' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                <th onClick={() => handleSort('totalImages')} className={`px-4 py-3 text-right text-sm font-semibold cursor-pointer select-none hover:text-cyan-300 ${themeConfig.text.primary}`}>
                  <div className="flex items-center justify-end gap-1">{t('imageService.cameras.totalImages')}
                    {sortCol === 'totalImages' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                <th onClick={() => handleSort('dateAdded')} className={thCls('dateAdded')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.dateAdded')}
                    {sortCol === 'dateAdded' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                <th onClick={() => handleSort('createdBy')} className={thCls('createdBy')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.createdBy')}
                    {sortCol === 'createdBy' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                <th className={`px-4 py-3 text-center text-sm font-semibold ${themeConfig.text.primary}`}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${themeConfig.tableDivide}`}>
              {paginated.map((camera: any, idx: number) => {
                const statusStyle = CAMERA_STATUS_STYLES[camera.status] ?? CAMERA_STATUS_STYLES.inactive;
                const StatusIcon = statusStyle.icon;
                return (
                  <tr key={camera.id} className={`border-b ${themeConfig.tableBorder} ${themeConfig.tableRow}`}>
                    <td className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(camera.id)}
                        onChange={() => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            if (next.has(camera.id)) {
                              next.delete(camera.id);
                            } else {
                              next.add(camera.id);
                            }
                            return next;
                          });
                        }}
                        className="w-4 h-4 rounded accent-cyan-500 cursor-pointer"
                      />
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.primary}`}>{(page - 1) * limit + idx + 1}</td>
                    <td className={`px-4 py-3 text-sm font-medium ${themeConfig.text.primary}`}>
                      <div className="flex items-center gap-2">
                        <Camera size={14} className="text-cyan-400" />
                        <button onClick={() => navigate(`/cctv/cameras/${camera.id}`)}
                          className="hover:text-cyan-300 transition-colors text-left">
                          {camera.name}
                        </button>
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{camera.ipAddress}</td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {camera.cameraTypeCode
                        ? (() => { const ct = cameraTypes.find((c: any) => c.code === camera.cameraTypeCode); return ct ? getLocalizedValue(ct, i18n.language) : camera.cameraTypeCode; })()
                        : '—'}
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {(() => {
                        const p = (policies as any[]).find((rp: any) => rp.id === camera.retentionPolicyId);
                        if (!p) return '—';
                        const nameMap: Record<string, string> = {
                          'Default Retention': 'imageService.retention.defaultName',
                          'Long-Term Retention': 'imageService.retention.longTermName',
                          'การจัดเก็บเริ่มต้น (Default)': 'imageService.retention.defaultName',
                          'การจัดเก็บระยะยาว (Long-Term)': 'imageService.retention.longTermName',
                        };
                        const translationKey = nameMap[p.name];
                        return translationKey ? t(translationKey) : p.name;
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${OPERATIONAL_STATUS_DOT[camera.operationalStatus] ?? OPERATIONAL_STATUS_DOT.unknown}`}
                          title={`${t('imageService.cameras.operationalStatus')}: ${t(`imageService.cameras.operational.${camera.operationalStatus ?? 'unknown'}`)}`}
                        />
                        <button
                          onClick={() => canUpdate && openStatusDialog(camera)}
                          disabled={changingStatus.has(camera.id) || !canUpdate}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1 transition-all ${canUpdate ? 'cursor-pointer hover:ring-1 hover:ring-white/20' : 'cursor-default'} ${statusStyle.bg}`}
                          title={canUpdate ? t('imageService.incidents.changeStatus') : ''}
                        >
                          {changingStatus.has(camera.id) ? (
                            <RefreshCw size={11} className="animate-spin" />
                          ) : (
                            <StatusIcon size={11} />
                          )}
                          {t(`imageService.cameras.${camera.status}`)}
                          {canUpdate && <ChevronDown size={10} className="ml-0.5 opacity-60" />}
                        </button>
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {camera.lastPolledAt ? formatDateTime(camera.lastPolledAt, i18n.language) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-sm text-right ${themeConfig.text.primary}`}>
                      {Number(camera.totalImagesCount ?? 0).toLocaleString()}
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {camera.createdAt ? formatDateTime(camera.createdAt, i18n.language) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {camera.createdBy || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handleScanCamera(camera.id)}
                          disabled={scanningCameras.has(camera.id)}
                          className="p-2 rounded-lg hover:bg-green-500/20">
                          <RefreshCw size={15} className={`${scanningCameras.has(camera.id) ? 'animate-spin text-green-400' : 'text-green-500'}`} />
                        </button>
                        <button onClick={() => openEdit(camera)}
                          className="p-2 rounded-lg hover:bg-yellow-500/20"><Edit size={15} className="text-yellow-500" /></button>
                        {canDelete && (
                          <button onClick={() => openDeleteModal(camera)}
                            className="p-2 rounded-lg hover:bg-red-500/20"
                            title={t('imageService.cameras.deleteCamera')}>
                            <Trash2 size={15} className="text-red-500" />
                          </button>
                        )}
                        <button onClick={() => openClone(camera)}
                          className="p-2 rounded-lg hover:bg-cyan-500/20"
                          title={t('imageService.cameras.clone')}>
                          <Copy size={15} className="text-cyan-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="py-2.5 px-4 border-t flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-950/20" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
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
                options={[10, 50, 100, 250, 500].map(val => ({
                  value: String(val),
                  label: String(val)
                }))}
              />
            </div>
            <span className={`ml-2 px-2 py-1 rounded bg-white/5 border border-white/10 ${themeConfig.text.secondary}`}>
              {t('imageService.cameras.totalCameras', { count: totalItems })}
            </span>
          </div>

          {totalPages > 0 && (
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              <button disabled={page <= 1} onClick={() => setPage(1)}
                className={`px-2.5 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                « {t('common.first') || t('common.first')}
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
              <button disabled={page >= totalPages} onClick={() => setPage(totalPages)}
                className={`px-2.5 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                {t('common.last') || t('common.last')} »
              </button>
            </div>
          )}
        </div>
      </div>
    )}
    </div>

      <Modal isOpen={modal.open} onClose={() => setModal({ open: false })}
        title={modal.item ? t('imageService.cameras.editCamera') : t('imageService.cameras.newCamera')}>
        <form onSubmit={handleSubmit} className="space-y-4 p-1 max-w-lg">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.cameraName')} <span className="text-red-400">*</span>
              </label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${isNameDuplicate ? 'border-red-500 focus:ring-red-500/50' : themeConfig.inputBorder} ${themeConfig.text.primary}`} required />
              {isNameDuplicate && (
                <p className="text-xs text-red-500 mt-1">
                  {t('imageService.cameras.validation.nameDuplicateError')}
                </p>
              )}
            </div>
            <div className="col-span-2">
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.description')}{cameraStar('description')}
              </label>
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={2}
                placeholder={t('imageService.cameras.descriptionPlaceholder')}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
            </div>
            <div className="col-span-2">
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.template')}{cameraStar('templateId')}
              </label>
              <SearchableSelect value={form.templateId} onChange={handleTemplateChange}
                placeholder={t('imageService.cameras.templateNone')}
                options={[{ value: '', label: t('imageService.cameras.templateNone') }, ...(templates as any[]).filter((tp: any) => tp.isActive).map((tp: any) => ({ value: tp.id, label: tp.isDefault ? `${tp.name} ★` : tp.name }))]} />
              <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>{t('imageService.cameras.templateHint')}</p>
            </div>
            <div className="col-span-2">
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.ipAddress')} <span className="text-red-400">*</span>
              </label>
              <input value={form.ipAddress} onChange={e => handleIpChange(e.target.value)}
                placeholder={t('imageService.cameras.ipExample')}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${ipDupCamera ? 'border-yellow-500 focus:ring-yellow-500/50' : themeConfig.inputBorder} ${themeConfig.text.primary}`} required />
              <p className={`text-[10px] mt-0.5 ${themeConfig.text.secondary}`}>
                {t('imageService.cameras.ipExample')}
              </p>
              {ipDupCamera && (
                <p className="text-xs text-yellow-400 mt-1">
                  {t('imageService.cameras.validation.ipDuplicateWarning', { name: ipDupCamera.name })}
                </p>
              )}
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.smbUsername')} <span className="text-red-400">*</span>
              </label>
              <input value={form.smbUsername} onChange={e => setForm(p => ({ ...p, smbUsername: e.target.value }))}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} required />
              <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>
                {t('imageService.cameras.smbUsernameHint')}
              </p>
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.smbPassword')}{cameraStar('smbPasswordEncrypted')}
              </label>
              <input type="password" autoComplete="new-password" value={form.smbPasswordEncrypted}
                onChange={e => setForm(p => ({ ...p, smbPasswordEncrypted: e.target.value }))}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
              <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>
                {modal.item ? t('imageService.cameras.smbPasswordHintEdit') : t('imageService.cameras.smbPasswordHintCreate')}
              </p>
            </div>
            <div className="col-span-2">
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.smbPath')} <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-2">
                <input value={form.smbSharePath} onChange={e => setForm(p => ({ ...p, smbSharePath: e.target.value }))}
                  placeholder={t('imageService.cameras.smbPathExample')}
                  className={`flex-1 px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${smbDupCamera ? 'border-yellow-500 focus:ring-yellow-500/50' : themeConfig.inputBorder} ${themeConfig.text.primary}`} required />
                <button type="button" onClick={handleTestConnection} disabled={testResult.loading}
                  className={`px-3 py-2 rounded-md text-xs font-medium border ${themeConfig.inputBorder} ${themeConfig.text.primary} hover:bg-white/5`}>
                  {testResult.loading ? <RefreshCw size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                  <span className="ml-1 hidden sm:inline">{t('imageService.cameras.testConnection')}</span>
                </button>
                <button type="button" onClick={openBrowse}
                  className={`px-3 py-2 rounded-md text-xs font-medium border ${themeConfig.inputBorder} ${themeConfig.text.primary} hover:bg-white/5`}>
                  <FolderOpen size={14} /><span className="ml-1 hidden sm:inline">{t('common.browse')}</span>
                </button>
              </div>
              <p className={`text-[10px] mt-0.5 ${themeConfig.text.secondary}`}>
                {t('imageService.cameras.smbPathExample')}
              </p>
              {smbDupCamera && (
                <p className="text-xs text-yellow-400 mt-1">
                  {t('imageService.cameras.validation.smbDuplicateWarning', { name: smbDupCamera.name })}
                </p>
              )}
              {testResult.message && (
                <p className={`text-xs mt-1 ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {testResult.success ? <CheckCircle size={12} className="inline mr-1" /> : <XCircle size={12} className="inline mr-1" />}
                  {testResult.message}
                </p>
              )}
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.cameraType')}{cameraStar('cameraTypeCode')}
              </label>
              <SearchableSelect value={form.cameraTypeCode} onChange={v => setForm(p => ({ ...p, cameraTypeCode: v }))}
                placeholder={t('common.select')}
                options={[{ value: '', label: '-' }, ...cameraTypes.filter((ct: any) => ct.isActive).map((ct: any) => ({ value: ct.code, label: ct.isDefault ? `${getLocalizedValue(ct, i18n.language)} ★` : getLocalizedValue(ct, i18n.language) }))]} />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.viewpoint', 'มุมมองภาพ')}{cameraStar('viewpointCode')}
              </label>
              <SearchableSelect value={form.viewpointCode} onChange={v => setForm(p => ({ ...p, viewpointCode: v }))}
                placeholder={t('common.select')}
                options={[{ value: '', label: '-' }, ...viewpoints.filter((vp: any) => vp.isActive).map((vp: any) => ({ value: vp.code, label: getLocalizedValue(vp, i18n.language) }))]} />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.captureMode')}{cameraStar('captureMode')}
              </label>
              <SearchableSelect value={form.captureMode} onChange={v => setForm(p => ({ ...p, captureMode: v }))}
                placeholder={t('common.select')}
                options={captureModes.filter((cm: any) => cm.isActive).length > 0
                  ? captureModes.filter((cm: any) => cm.isActive).map((cm: any) => ({ value: cm.code, label: getLocalizedValue(cm, i18n.language) }))
                  : ['periodic', 'on_demand', 'continuous'].map(m => ({ value: m, label: t(`imageService.cameras.captureMode${m.charAt(0).toUpperCase() + m.slice(1)}`) }))
                } />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.pollInterval')}{cameraStar('pollIntervalSeconds')}
              </label>
              <input type="number" value={form.pollIntervalSeconds}
                onChange={e => setForm(p => ({ ...p, pollIntervalSeconds: parseInt(e.target.value) || 30 }))}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.slaTarget')}
              </label>
              <input type="number" step="0.01" min="0" max="100" value={form.slaTargetPercent}
                placeholder={t('imageService.cameras.slaTargetPlaceholder')}
                onChange={e => setForm(p => ({ ...p, slaTargetPercent: e.target.value }))}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
              <p className={`text-[11px] mt-1 ${themeConfig.text.secondary}`}>{t('imageService.cameras.slaTargetHint')}</p>
            </div>
            <div className="col-span-2">
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('imageService.cameras.retentionPolicy')} <span className="text-red-400">*</span>
              </label>
              <SearchableSelect value={form.retentionPolicyId} onChange={v => setForm(p => ({ ...p, retentionPolicyId: v }))}
                placeholder={t('common.select')}
                options={policies.map((p: any) => ({ value: p.id, label: p.isDefault ? `${p.name} ★` : p.name }))} />
            </div>
          </div>

          {/* Collapsible per-camera processing overrides (blank = inherit from template) */}
          <div className="border rounded-md" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <button type="button" onClick={() => setShowOverrides(s => !s)}
              className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium ${themeConfig.text.primary}`}>
              <span>{t('imageService.cameras.overrideSection')}</span>
              {showOverrides ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {showOverrides && (
              <div className="px-3 pb-3 space-y-3">
                <p className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.cameras.overrideHint')}</p>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${themeConfig.text.primary}`}>{t('imageService.cameras.acceptedExtensions')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SOURCE_EXTENSIONS.map(ext => {
                      const active = form.acceptedExtensions.includes(ext);
                      return (
                        <button key={ext} type="button"
                          onClick={() => setForm(p => ({ ...p, acceptedExtensions: active ? p.acceptedExtensions.filter(x => x !== ext) : [...p.acceptedExtensions, ext] }))}
                          className={`px-2.5 py-1 rounded-full text-xs border ${active ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : `${themeConfig.inputBorder} ${themeConfig.text.secondary}`}`}>
                          {ext}
                        </button>
                      );
                    })}
                  </div>
                  <p className={`text-[11px] mt-1 ${themeConfig.text.secondary}`}>{t('imageService.cameras.acceptedExtensionsHint')}</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    ['convertToPng', 'convertToPng'],
                    ['keepSmaller', 'keepSmaller'],
                    ['generateThumbnail', 'generateThumbnail'],
                  ] as const).map(([field, key]) => (
                    <div key={field}>
                      <label className={`block text-xs font-medium mb-1 ${themeConfig.text.primary}`}>{t(`imageService.cameras.${key}`)}</label>
                      <SearchableSelect value={(form as any)[field]} onChange={v => setForm(p => ({ ...p, [field]: v }))}
                        options={[
                          { value: 'inherit', label: t('imageService.cameras.inherit') },
                          { value: 'true', label: t('common.yes') },
                          { value: 'false', label: t('common.no') },
                        ]} />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-xs font-medium mb-1 ${themeConfig.text.primary}`}>{t('imageService.cameras.thumbnailSize')}</label>
                    <input type="number" value={form.thumbnailSize} placeholder={t('imageService.cameras.inherit')}
                      onChange={e => setForm(p => ({ ...p, thumbnailSize: e.target.value }))}
                      className={`w-full px-3 py-2 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
                  </div>
                  <div>
                    <label className={`block text-xs font-medium mb-1 ${themeConfig.text.primary}`}>{t('imageService.cameras.compressionQuality')}</label>
                    <input type="number" value={form.compressionQuality} placeholder={t('imageService.cameras.inherit')}
                      onChange={e => setForm(p => ({ ...p, compressionQuality: e.target.value }))}
                      className={`w-full px-3 py-2 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <Button variant="secondary" type="button" onClick={() => setModal({ open: false })}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={submitting || isNameDuplicate}>{submitting ? t('common.saving') : t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={browseOpen} onClose={() => setBrowseOpen(false)}
        title={t('imageService.cameras.browseSmb')}>
        <div className="max-h-80 overflow-y-auto p-1 space-y-1">
          {browseLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={20} className="animate-spin text-cyan-400" />
            </div>
          ) : browseStep === 'shares' ? (
            browseShares.length === 0 ? (
              <p className={`text-sm text-center py-4 ${themeConfig.text.secondary}`}>{t('common.noData')}</p>
            ) : (
              browseShares.map(s => (
                <button key={s.name} onClick={() => browseShare(s.name)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center justify-between hover:bg-white/5 ${themeConfig.text.primary}`}>
                  <span className="flex items-center gap-2"><FolderOpen size={15} />{s.name}</span>
                  <span className={`text-xs ${themeConfig.text.secondary}`}>{s.description}</span>
                </button>
              ))
            )
          ) : (
            <>
              <div className="flex items-center gap-1.5 mb-2 text-xs">
                <button onClick={goBackShares} className="text-cyan-400 hover:underline">{t('imageService.cameras.shares')}</button>
                <ChevronRight size={10} className={themeConfig.text.secondary} />
                <span className={themeConfig.text.secondary}>{browsePath}</span>
              </div>
              <button onClick={() => selectBrowsePath('')}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm border border-dashed hover:bg-white/5 ${themeConfig.text.primary} ${themeConfig.inputBorder}`}>
                {t('imageService.cameras.useCurrentFolder')}
              </button>
              {browseItems.filter(e => e.isDirectory).map(e => (
                <div key={e.name} className="flex items-center gap-1">
                  <button onClick={() => browseFolder(e.name)}
                    className={`flex-1 text-left px-3 py-2 rounded-lg text-sm hover:bg-white/5 ${themeConfig.text.primary}`}>
                    <span className="flex items-center gap-2"><FolderOpen size={14} />{e.name}</span>
                  </button>
                  <button onClick={() => selectBrowsePath(e.name)}
                    className="px-2 py-2 rounded text-xs text-cyan-400 hover:bg-white/5"
                    title={t('common.select')}><CheckCircle size={14} /></button>
                </div>
              ))}
            </>
          )}
        </div>
      </Modal>

      {/* Delete Camera Confirmation Modal */}
      <Modal isOpen={deleteModal.open} onClose={() => { setDeleteModal({ open: false }); setDeletePassword(''); }}
        title={t('imageService.cameras.deleteCamera')}>
        <div className="space-y-4 p-1">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className={`text-sm ${themeConfig.text.primary}`}>
                {deleteModal.camera?.name}
              </p>
              <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>
                {t('imageService.cameras.deleteCameraConfirm')}
              </p>
            </div>
          </div>
          <input
            type="password" autoComplete="new-password"
            value={deletePassword}
            onChange={e => setDeletePassword(e.target.value)}
            placeholder={t('common.enterPassword')}
            className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
            onKeyDown={e => { if (e.key === 'Enter' && deletePassword) handleDeleteCamera(); }}
          />
          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <Button variant="secondary" onClick={() => { setDeleteModal({ open: false }); setDeletePassword(''); }}>
              {t('common.cancel')}
            </Button>
            <button onClick={handleDeleteCamera} disabled={!deletePassword || deleting}
              className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 flex items-center gap-1.5 transition-colors">
              <Trash2 size={14} /> {deleting ? t('common.saving') : t('imageService.cameras.deleteCamera')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Delete Camera Confirmation Modal */}
      <Modal isOpen={bulkDeleteModal.open} onClose={() => { setBulkDeleteModal({ open: false }); setBulkDeletePassword(''); }}
        title={t('imageService.cameras.bulkDeleteConfirmTitle')}>
        <div className="space-y-4 p-1">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className={`text-sm ${themeConfig.text.primary}`}>
                {t('imageService.cameras.bulkDeleteConfirmBody', { count: selectedIds.size })}
              </p>
            </div>
          </div>
          <input
            type="password" autoComplete="new-password"
            value={bulkDeletePassword}
            onChange={e => setBulkDeletePassword(e.target.value)}
            placeholder={t('common.enterPassword')}
            className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
            onKeyDown={e => { if (e.key === 'Enter' && bulkDeletePassword) handleBulkDelete(); }}
          />
          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <Button variant="secondary" onClick={() => { setBulkDeleteModal({ open: false }); setBulkDeletePassword(''); }}>
              {t('common.cancel')}
            </Button>
            <button onClick={handleBulkDelete} disabled={!bulkDeletePassword || bulkDeleting}
              className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 flex items-center gap-1.5 transition-colors">
              <Trash2 size={14} /> {bulkDeleting ? t('common.saving') : t('imageService.cameras.bulkDelete')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Clone Camera Confirmation Modal */}
      <Modal isOpen={bulkCloneModal.open} onClose={() => setBulkCloneModal({ open: false })}
        title={t('imageService.cameras.bulkCloneConfirmTitle')}>
        <div className="space-y-4 p-1">
          <div className="flex items-start gap-2">
            <Camera size={16} className="text-cyan-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className={`text-sm ${themeConfig.text.primary}`}>
                {t('imageService.cameras.bulkCloneConfirmBody', { count: selectedIds.size })}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <Button variant="secondary" onClick={() => setBulkCloneModal({ open: false })}>
              {t('common.cancel')}
            </Button>
            <button onClick={handleBulkClone} disabled={bulkCloning}
              className="px-4 py-2 rounded-md text-sm font-medium bg-cyan-600 hover:bg-cyan-700 text-white disabled:opacity-40 flex items-center gap-1.5 transition-colors">
              <Copy size={14} /> {bulkCloning ? t('common.saving') : t('imageService.cameras.bulkClone')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Camera Trash Modal */}
      <Modal isOpen={trashOpen} onClose={() => { setTrashOpen(false); setShowEmptyConfirm(false); setEmptyTrashPassword(''); setPermaDeleteTarget(null); setPermaDeletePassword(''); }}
        title={t('imageService.cameras.cameraTrash')} size="5xl">
        <div className="space-y-4 p-1 max-w-full">
          {/* Filters Row */}
          <div className="flex items-end gap-3 bg-white/5 p-3 rounded-lg border border-white/10">
            <div className="flex-1">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${themeConfig.text.secondary}`}>
                {t('imageService.cameras.cameraName')}
              </label>
              <input
                type="text"
                value={trashQ}
                onChange={e => setTrashQ(e.target.value)}
                className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50 h-[38px]`}
                placeholder={t('ui.imageServiceCameras.searchNameIp')}
              />
            </div>
            <div className="w-36">
              <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${themeConfig.text.secondary}`}>
                {t('ui.imageServiceCameras.startDateDeleteFrom')}
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
                {t('ui.imageServiceCameras.endDateDeleteUntil')}
              </label>
              <input
                type="date"
                value={trashEndDate}
                onChange={e => setTrashEndDate(e.target.value)}
                className={`w-full px-3 py-2 border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} rounded-md text-sm focus:outline-none h-[38px]`}
              />
            </div>
            {(trashQ || trashStartDate || trashEndDate) && (
              <button
                onClick={() => { setTrashQ(''); setTrashStartDate(''); setTrashEndDate(''); }}
                className={`px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} hover:bg-white/5 text-gray-300 transition-colors h-[38px] flex items-center justify-center`}
                title={t('ui.imageServiceCameras.clearFilters')}
              >
                {t('ui.imageServiceCameras.clear')}
              </button>
            )}
          </div>

          {/* Bulk selected action bar */}
          {trashSelected.size > 0 && (
            <div className="flex items-center justify-between p-2.5 bg-cyan-950/40 border border-cyan-800/40 rounded-lg text-xs text-cyan-200">
              <div className="flex items-center gap-2">
                <span className="font-medium">{trashSelected.size}{' '}{t('common.records')}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={trashBulkRestoring}
                  onClick={handleRestoreSelectedCameraTrash}
                  className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
                >
                  <Undo2 size={12} /> {t('imageService.cameras.restoreCamera')}
                </button>
                {canDelete && (
                  <button
                    disabled={trashBulkDeleting}
                    onClick={() => { setShowEmptyConfirm(false); setPermaDeleteTarget(null); setBulkDeleteTrashPassword(''); setShowBulkDeleteTrashConfirm(true); }}
                    className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white font-medium flex items-center gap-1.5 transition-colors disabled:opacity-40"
                  >
                    <Trash2 size={12} /> {t('imageService.cameras.permanentDeleteCamera')}
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
                  {t('ui.imageServiceCameras.confirmDeletingTheSelected')}{' '}{trashSelected.size}{' '}{t('ui.imageServiceCameras.camerasPermanentlyPreviouslyProcessedImagesAre')}
                </p>
              </div>
              <input
                type="password" autoComplete="new-password"
                value={bulkDeleteTrashPassword}
                onChange={e => setBulkDeleteTrashPassword(e.target.value)}
                placeholder={t('common.enterPassword')}
                className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
                onKeyDown={e => { if (e.key === 'Enter' && bulkDeleteTrashPassword && !trashBulkDeleting) handleDeleteSelectedCameraTrashPermanently(); }}
              />
              <div className="flex gap-2">
                <button onClick={() => { setShowBulkDeleteTrashConfirm(false); setBulkDeleteTrashPassword(''); }}
                  className={`px-3 py-1.5 rounded-md text-xs ${themeConfig.text.secondary} hover:bg-white/5`}>
                  {t('common.cancel')}
                </button>
                <button onClick={handleDeleteSelectedCameraTrashPermanently} disabled={!bulkDeleteTrashPassword || trashBulkDeleting}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 flex items-center gap-1.5">
                  <Trash2 size={12} /> {t('imageService.cameras.permanentDeleteCamera')}
                </button>
              </div>
            </div>
          )}

          {trashLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={20} className="animate-spin text-cyan-400" />
            </div>
          ) : filteredTrashData.length > 0 ? (
            <>
              <p className={`text-xs ${themeConfig.text.secondary}`}>
                {t('imageService.cameras.cameraTrashCount', { count: filteredTrashData.length })}
              </p>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full">
                  <thead className={themeConfig.tableHeader}>
                    <tr>
                      <th className="px-3 py-2 text-left w-10">
                        <input
                          type="checkbox"
                          checked={pagedTrashData.length > 0 && pagedTrashData.every((item: any) => trashSelected.has(item.id))}
                          onChange={handleTrashSelectAllToggle}
                          className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50 bg-white/10 cursor-pointer"
                        />
                      </th>
                      <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.cameraName')}</th>
                      <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.ipAddress')}</th>
                      <th className={`px-3 py-2 text-left text-xs font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.deleteCamera')}</th>
                      <th className={`px-3 py-2 text-center text-xs font-semibold ${themeConfig.text.primary}`}>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${themeConfig.tableDivide}`}>
                    {pagedTrashData.map((item: any) => (
                      <tr key={item.id} className={themeConfig.tableRow}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={trashSelected.has(item.id)}
                            onChange={() => handleTrashSelectToggle(item.id)}
                            className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50 bg-white/10 cursor-pointer"
                          />
                        </td>
                        <td className={`px-3 py-2 text-sm ${themeConfig.text.primary}`}>{item.name}</td>
                        <td className={`px-3 py-2 text-sm ${themeConfig.text.secondary}`}>{item.ipAddress}</td>
                        <td className={`px-3 py-2 text-xs ${themeConfig.text.secondary}`}>
                          {item.deletedAt ? formatDateTime(item.deletedAt, i18n.language) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => handleRestoreCamera(item.id)}
                              className="p-1.5 rounded-lg hover:bg-green-500/20 text-green-400"
                              title={t('imageService.cameras.restoreCamera')}>
                              <Undo2 size={14} />
                            </button>
                            {canDelete && (
                              <button onClick={() => { setShowEmptyConfirm(false); setPermaDeleteTarget({ id: item.id, name: item.name }); setPermaDeletePassword(''); }}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400"
                                title={t('imageService.cameras.permanentDeleteCamera')}>
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {trashTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button disabled={trashPage <= 1} onClick={() => setTrashPage(p => p - 1)}
                    className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                    {t('common.prev')}
                  </button>
                  <span className={`text-xs ${themeConfig.text.secondary}`}>{trashPage} / {trashTotalPages}</span>
                  <button disabled={trashPage >= trashTotalPages} onClick={() => setTrashPage(p => p + 1)}
                    className={`px-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                    {t('common.next')}
                  </button>
                </div>
              )}

              {permaDeleteTarget && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className={`text-xs ${themeConfig.text.secondary}`}>
                      {t('imageService.cameras.permanentDeleteCameraConfirm', { name: permaDeleteTarget.name })}
                    </p>
                  </div>
                  <input
                    type="password" autoComplete="new-password"
                    value={permaDeletePassword}
                    onChange={e => setPermaDeletePassword(e.target.value)}
                    placeholder={t('common.enterPassword')}
                    className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
                    onKeyDown={e => { if (e.key === 'Enter' && permaDeletePassword && !permaDeleting) handlePermanentDeleteCamera(); }}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => { setPermaDeleteTarget(null); setPermaDeletePassword(''); }}
                      className={`px-3 py-1.5 rounded-md text-xs ${themeConfig.text.secondary} hover:bg-white/5`}>
                      {t('common.cancel')}
                    </button>
                    <button onClick={handlePermanentDeleteCamera} disabled={!permaDeletePassword || permaDeleting}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 flex items-center gap-1.5">
                      <Trash2 size={12} /> {t('imageService.cameras.permanentDeleteCamera')}
                    </button>
                  </div>
                </div>
              )}

              {showEmptyConfirm && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <p className={`text-xs ${themeConfig.text.secondary}`}>
                      {t('imageService.cameras.emptyCameraTrashConfirm')}
                    </p>
                  </div>
                  <input
                    type="password" autoComplete="new-password"
                    value={emptyTrashPassword}
                    onChange={e => setEmptyTrashPassword(e.target.value)}
                    placeholder={t('common.enterPassword')}
                    className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
                    onKeyDown={e => { if (e.key === 'Enter' && emptyTrashPassword) handleEmptyCameraTrash(); }}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => { setShowEmptyConfirm(false); setEmptyTrashPassword(''); }}
                      className={`px-3 py-1.5 rounded-md text-xs ${themeConfig.text.secondary} hover:bg-white/5`}>
                      {t('common.cancel')}
                    </button>
                    <button onClick={handleEmptyCameraTrash} disabled={!emptyTrashPassword}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 flex items-center gap-1.5">
                      <Trash2 size={12} /> {t('imageService.cameras.emptyCameraTrash')}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <Button variant="secondary" onClick={() => { setTrashOpen(false); setShowEmptyConfirm(false); setEmptyTrashPassword(''); setPermaDeleteTarget(null); setPermaDeletePassword(''); }}>
                  {t('common.close')}
                </Button>
                <button
                  onClick={handleRestoreAllCameraTrash}
                  disabled={restoringAllTrash || trashSelected.size > 0}
                  className="px-4 py-2 rounded-md text-sm font-medium bg-green-600 hover:bg-green-700 text-white flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Undo2 size={14} /> {t('imageService.cameras.restoreAllCameras')}
                </button>
                {canDelete && !showEmptyConfirm && (
                  <button onClick={() => { setPermaDeleteTarget(null); setShowEmptyConfirm(true); }}
                    disabled={trashSelected.size > 0}
                    className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                    <Trash2 size={14} /> {t('imageService.cameras.emptyCameraTrash')}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className={`text-center py-12 ${themeConfig.text.secondary}`}>
              <Trash2 size={48} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">{t('imageService.cameras.cameraTrashEmpty')}</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Status Change Dialog */}
      {(() => {
        const PRIORITY_OPTIONS = [
          { value: 'critical', labelKey: 'priorityCritical', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
          { value: 'high', labelKey: 'priorityHigh', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
          { value: 'medium', labelKey: 'priorityMedium', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
          { value: 'low', labelKey: 'priorityLow', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
        ];
        const IMPACT_OPTIONS = [
          { value: 'none', labelKey: 'impactNone' },
          { value: 'partial', labelKey: 'impactPartial' },
          { value: 'full', labelKey: 'impactFull' },
        ];
        return (
          <Modal isOpen={statusDialog.open} onClose={() => setStatusDialog({ open: false })}
            title={t('imageService.incidents.statusChangeTitle')} size="4xl">
            <div className="space-y-4 p-1">
              {/* 1. Camera name + current status badge */}
              <div className="flex items-center gap-2">
                <Camera size={16} className="text-cyan-400" />
                <span className={`text-sm font-semibold ${themeConfig.text.primary}`}>{statusDialog.camera?.name}</span>
                {statusDialog.camera && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${CAMERA_STATUS_STYLES[statusDialog.camera.status]?.bg}`}>
                    {t(`imageService.cameras.${statusDialog.camera.status}`)}
                  </span>
                )}
              </div>

              {/* 2. Select new status */}
              <div>
                <label className={`block text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
                  {t('imageService.incidents.selectStatus')} <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {STATUS_RADIO_OPTIONS.filter(opt => opt.value !== statusDialog.camera?.status).map(opt => {
                    const OptIcon = opt.icon;
                    const selected = statusForm.status === opt.value;
                    return (
                      <button key={opt.value} type="button"
                        onClick={() => setStatusForm((p: any) => ({ ...p, status: opt.value }))}
                        className={`px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 border transition-all ${selected ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500/30' : 'border-white/10 hover:border-white/20 hover:bg-white/5'}`}>
                        <span className={`${opt.bg.split(' ').filter((c: string) => c.startsWith('text-')).join(' ')}`}>
                          <OptIcon size={14} />
                        </span>
                        <span className={`${selected ? 'text-cyan-300' : themeConfig.text.primary}`}>{opt.label}</span>
                        {selected && <CheckCircle size={12} className="ml-auto text-cyan-400" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Priority */}
              <div>
                <label className={`block text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
                  {t('imageService.incidents.priority')}{incidentStar('priority')}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {PRIORITY_OPTIONS.map(p => {
                    const selected = statusForm.priority === p.value;
                    return (
                      <button key={p.value} type="button"
                        onClick={() => setStatusForm((prev: any) => ({ ...prev, priority: p.value }))}
                        className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${p.color} ${selected ? 'ring-1 ring-white/30 opacity-100' : 'opacity-60 hover:opacity-90'}`}>
                        {t(`imageService.incidents.${p.labelKey}`)}
                        {selected && <CheckCircle size={10} className="inline ml-1" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Fields shown only when going to non-active status */}
              {statusForm.status && statusForm.status !== 'active' && (
                <>
                  {/* 4. Reason */}
                  <div>
                    <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                      {t('imageService.incidents.reason')} <span className="text-red-400">*</span>
                    </label>
                    <SearchableSelect value={statusForm.reason} onChange={v => setStatusForm((p: any) => ({ ...p, reason: v }))}
                      placeholder={t('imageService.incidents.reason')}
                      options={(incidentOptions?.reasons || []).map((r: any) => ({
                        value: r.code, label: getLocalizedValue(r, i18n.language),
                      }))} />
                  </div>


                  {/* 6. Problem Description */}
                  <div>
                    <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                      {t('imageService.incidents.problemDesc')}{incidentStar('problemDesc')}
                    </label>
                    <textarea value={statusForm.problemDesc}
                      onChange={e => setStatusForm((p: any) => ({ ...p, problemDesc: e.target.value }))}
                      rows={3}
                      className={`w-full px-3 py-2 rounded-md text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary} resize-none`}
                      placeholder={t('imageService.incidents.problemDesc')} />
                  </div>

                  {/* 7. Resolution description (if applicable) */}
                  <div>
                    <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                      {t('imageService.incidents.resolutionDesc')}
                    </label>
                    <textarea value={statusForm.resolutionDesc}
                      onChange={e => setStatusForm((p: any) => ({ ...p, resolutionDesc: e.target.value }))}
                      rows={2}
                      className={`w-full px-3 py-2 rounded-md text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary} resize-none`}
                      placeholder={t('imageService.incidents.resolutionDesc')} />
                  </div>

                  {/* 8. Attach Images */}
                  <div>
                    <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                      {t('imageService.incidents.attachImages')}{incidentStar('attachments')}
                    </label>
                    <div
                      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${attachDragOver ? 'border-cyan-500 bg-cyan-500/10' : 'border-white/20 hover:border-white/40 hover:bg-white/5'}`}
                      onDragOver={e => { e.preventDefault(); setAttachDragOver(true); }}
                      onDragLeave={() => setAttachDragOver(false)}
                      onDrop={e => { e.preventDefault(); setAttachDragOver(false); handleAttachFiles(e.dataTransfer.files); }}
                      onClick={() => {
                        if (attachmentFiles.length >= 3) { toast.warning(t('imageService.incidents.attachMaxFiles')); return; }
                        const inp = document.createElement('input');
                        inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
                        inp.onchange = () => handleAttachFiles(inp.files);
                        inp.click();
                      }}
                    >
                      <p className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.incidents.attachHint')}</p>
                    </div>
                    {attachmentPreviews.length > 0 && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {attachmentPreviews.map((src, idx) => (
                          <div key={idx} className="relative group">
                            <img src={src} alt="" className="w-20 h-20 object-cover rounded-lg border border-white/10" />
                            <button type="button"
                              onClick={() => handleRemoveAttachment(idx)}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              title={t('imageService.incidents.attachRemove')}>
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 9. Assigned To */}
                  <div>
                    <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                      {t('imageService.incidents.assignedTo')}{incidentStar('assignedTo')}
                    </label>
                    <div className="space-y-2">
                      {hasUsersPermission ? (
                        <>
                          <SearchableSelect
                            value={statusForm.assignedToType}
                            onChange={(v: string) => setStatusForm((p: any) => ({ ...p, assignedToType: v, assignedTo: v === 'other' ? '' : v }))}
                            options={[
                              ...users.map((u: any) => ({ value: u.name || u.username, label: u.name ? `${u.name} (${u.username})` : u.username })),
                              { value: 'other', label: t('imageService.incidents.assignedToOther') }
                            ]}
                            placeholder={t('imageService.incidents.assignedTo')}
                          />
                          {statusForm.assignedToType === 'other' && (
                            <input
                              value={statusForm.assignedToOther}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStatusForm((p: any) => ({ ...p, assignedToOther: e.target.value }))}
                              className={`w-full px-3 py-2 rounded-md text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`}
                              placeholder={t('imageService.incidents.enterAssignedToOther')}
                            />
                          )}
                        </>
                      ) : (
                        <input
                          value={statusForm.assignedTo}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStatusForm((p: any) => ({ ...p, assignedTo: e.target.value }))}
                          className={`w-full px-3 py-2 rounded-md text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`}
                          placeholder={t('imageService.incidents.assignedTo')}
                        />
                      )}
                    </div>
                  </div>

                  {/* 9.5. Observers */}
                  {hasUsersPermission && (
                    <div>
                      <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                        {t('imageService.incidents.observers')}
                      </label>
                      <div className="space-y-2">
                        {statusForm.observers && statusForm.observers.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 p-2 rounded-md bg-white/5 border border-white/10">
                            {statusForm.observers.map((obsName: string) => (
                              <span key={obsName} className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                                {obsName}
                                <button type="button" onClick={() => setStatusForm((p: any) => ({ ...p, observers: p.observers.filter((o: string) => o !== obsName) }))} className="hover:text-red-400 font-bold font-mono">×</button>
                              </span>
                            ))}
                          </div>
                        )}
                        <SearchableSelect
                          value=""
                          onChange={(v: string) => {
                            if (v && !statusForm.observers.includes(v)) {
                              setStatusForm((p: any) => ({ ...p, observers: [...p.observers, v] }));
                            }
                          }}
                          options={users.map((u: any) => ({ value: u.name || u.username, label: u.name ? `${u.name} (${u.username})` : u.username }))}
                          placeholder={t('imageService.incidents.observers')}
                        />
                      </div>
                    </div>
                  )}

                  {/* 10. Estimated Finish */}
                  {(statusForm.status === 'maintenance' || statusForm.status === 'inactive') && (
                    <div>
                      <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                        {t('imageService.incidents.estimatedFinish')}{incidentStar('estimatedFinish')}
                      </label>
                      <DateTimePicker
                        value={statusForm.estimatedFinish}
                        onChange={v => setStatusForm((p: any) => ({ ...p, estimatedFinish: v }))}
                      />
                    </div>
                  )}

                  {/* 11. Impact */}
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
                      {t('imageService.incidents.impact')}{incidentStar('impact')}
                    </label>
                    <div className="flex gap-3">
                      {IMPACT_OPTIONS.map(opt => (
                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="impact" value={opt.value}
                            checked={statusForm.impact === opt.value}
                            onChange={() => setStatusForm((p: any) => ({ ...p, impact: opt.value }))}
                            className="accent-cyan-400" />
                          <span className={`text-sm ${themeConfig.text.primary}`}>
                            {t(`imageService.incidents.${opt.labelKey}`)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <Button variant="secondary" onClick={() => setStatusDialog({ open: false })}>{t('common.cancel')}</Button>
                <Button onClick={handleStatusDialogConfirm}
                  disabled={!statusForm.status || (statusForm.status !== 'active' && !statusForm.reason)}>
                  {t('common.confirm')}
                </Button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* Resolution Dialog */}
      <Modal isOpen={resolveDialog.open} onClose={() => setResolveDialog({ open: false })}
        title={t('imageService.incidents.resolutionTitle')} size="4xl">
        <div className="space-y-4 p-1">
          {/* Camera name + transition */}
          <div className="flex items-center gap-2 flex-wrap">
            <Camera size={16} className="text-cyan-400" />
            <span className={`text-sm font-semibold ${themeConfig.text.primary}`}>{resolveDialog.camera?.name}</span>
            <span className="text-xs text-green-400">
              {resolveDialog.camera && t(`imageService.cameras.${resolveDialog.camera.status}`)} &rarr; {t('imageService.cameras.active')}
            </span>
          </div>

          {/* Resolution checkboxes */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
              {t('imageService.incidents.resolution')}
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(incidentOptions?.resolutions || []).map((r: any) => {
                const selected = resolveForm.resolution === r.code;
                return (
                  <button key={r.code} type="button"
                    onClick={() => setResolveForm(p => ({ ...p, resolution: selected ? '' : r.code }))}
                    className={`px-3 py-2 rounded-lg text-xs flex items-center gap-2 border transition-all text-left ${selected ? 'border-green-500 bg-green-500/10' : 'border-white/10 hover:border-white/20 hover:bg-white/5'}`}>
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${selected ? 'border-green-400 bg-green-500/30' : 'border-white/30'}`}>
                      {selected && <CheckCircle size={10} className="text-green-400" />}
                    </span>
                    <span className={`${selected ? 'text-green-300' : themeConfig.text.primary}`}>
                      {getLocalizedValue(r, i18n.language)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Root Cause */}
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.incidents.rootCause')}
            </label>
            <SearchableSelect value={resolveForm.rootCause} onChange={v => setResolveForm(p => ({ ...p, rootCause: v }))}
              placeholder={t('imageService.incidents.rootCause')}
              options={(incidentOptions?.rootCauses || []).map((r: any) => ({
                value: r.code, label: getLocalizedValue(r, i18n.language),
              }))} />
          </div>


          {/* Corrective Action */}
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.incidents.correctiveAction')}
            </label>
            <textarea value={resolveForm.correctiveAction}
              onChange={e => setResolveForm(p => ({ ...p, correctiveAction: e.target.value }))}
              rows={2}
              className={`w-full px-3 py-2 rounded-md text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary} resize-none`}
              placeholder={t('imageService.incidents.correctiveAction')} />
          </div>

          {/* Preventive Action */}
          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.incidents.preventiveAction')}
            </label>
            <textarea value={resolveForm.preventiveAction}
              onChange={e => setResolveForm(p => ({ ...p, preventiveAction: e.target.value }))}
              rows={2}
              className={`w-full px-3 py-2 rounded-md text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary} resize-none`}
              placeholder={t('imageService.incidents.preventiveAction')} />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <Button variant="secondary" onClick={() => setResolveDialog({ open: false })}>{t('common.cancel')}</Button>
            <Button onClick={handleResolveConfirm}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
