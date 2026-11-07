import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterdataOptions } from '@/hooks/useMasterdataOptions';
import { LocationFields } from '@/components/cctv/LocationFields';
import { LocationStatsLine } from '@/components/cctv/LocationStatsRow';
import { summarizeCameraList } from '@/lib/locationSummary';
import { applyCameraSelection, applyLocationFilter, cameraSearchText, matchesCameraQuery, NO_LOCATION } from '@/lib/cameraFilter';
import { CameraFilterDropdown } from '@/components/cctv/CameraFilterDropdown';
import { cleanShortCode } from '@/lib/clipName';
import { useSearchParams } from 'react-router-dom';
import { BulkCameraEditModal } from '@/components/cctv/BulkCameraEditModal';
import { DeletionImpactNote, useDeletionImpact } from '@/components/cctv/DeletionImpactNote';
import { hasPermission } from '@/App';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import { Search, Plus, ChevronUp, ChevronDown, ChevronsUpDown,
  Edit, Trash2, Eye, Camera, Activity, Wifi, WifiOff, AlertTriangle, Wrench,
  RefreshCw, CheckCircle, Play, Undo2, Copy , X } from 'lucide-react';
import { Modal, Button, SearchableSelect, TableSkeleton, ColumnSelector, ExportButton, DateTimePicker } from '@/components/ui';
import { getLocalizedValue } from '@/utils/textUtils';
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
  name: '', ipAddress: '', retentionPolicyId: '', description: '',
  // [R2.3] CCTV stream settings; the factory SMB/processing fields moved to camera_factory_settings.
  rtspUrl: '', rtspUrlSub: '', streamPath: '',
  templateId: '',
  slaTargetPercent: '',
  // Simple setup: the server builds the RTSP URLs from these. 'manual' = type the full URLs.
  connMode: 'simple' as 'simple' | 'manual',
  brand: 'auto', rtspPort: '554', channel: '1', username: 'admin', password: '',
  // live_only: the server pulls only while someone watches and keeps no files (DVR/NVRs record to their own HDD).
  recordingMode: 'live_only' as 'live_only' | 'continuous',
  enabled: true,
  cameraType: '', cameraBrand: '', cameraModel: '', shortCode: '', alertLevel: '',
  siteId: '', zoneId: '', locationFromDevice: true,
});

// Display-only copy of the server's URL builder (devices.service.ts buildChannelRtspUrl); the password is masked.
function previewRtspUrl(tpl: any, ip: string, port: string, channel: string, username: string, sub = false): string {
  if (!tpl || !ip) return '';
  const pattern: string = sub ? tpl.subStreamPattern : tpl.mainStreamPattern;
  const credsInPath = /\{username\}|\{password\}/.test(pattern);
  const auth = !credsInPath && username ? `${encodeURIComponent(username)}:********@` : '';
  const path = pattern
    .replace(/\{channel\}/g, channel || '1')
    .replace(/\{username\}/g, encodeURIComponent(username))
    .replace(/\{password\}/g, '********');
  return `rtsp://${auth}${ip}:${port || '554'}${path}`;
}

// A stored RTSP URL comes back redacted (user:********@); sending it back means "unchanged".
const isRedactedRtsp = (url?: string | null) => !!url && url.includes('********');

// Save/restore errors the operator can act on, in their language; anything else stays generic.
function cameraErrorMessage(e: any, t: (k: string, o?: any) => string): string {
  const data = e?.response?.data;
  if (data?.details?.code === 'CAMERA_NAME_TAKEN') return t('imageService.cameras.validation.nameDuplicateError');
  if (data?.details?.code === 'CAMERA_NAME_IN_TRASH') return t('imageService.cameras.validation.nameInTrash');
  if (data?.details?.code === 'UNIQUE_VIOLATION') return t('imageService.cameras.validation.duplicateValue');
  if (e?.response?.status === 400 && data?.message) return `${t('common.error')}: ${data.message}`;
  return t('common.error');
}

export default function ImageServiceCameras() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { options: cameraTypeOptions } = useMasterdataOptions('camera_type');
  const { options: cameraBrandOptions } = useMasterdataOptions('camera_brand');
  const { options: alertLevelOptions } = useMasterdataOptions('alert_level');
  const alertLevelLabel = (code?: string | null) => alertLevelOptions.find((o) => o.value === code)?.label;
  const defaultAlertLevelLabel = alertLevelOptions.find((o) => o.isDefault)?.label ?? '';
  // What really applies to a camera: its own level, else its device's, else the default.
  const inheritedAlertLevelLabel = (device?: { alertLevel?: string | null } | null) => alertLevelLabel(device?.alertLevel) ?? defaultAlertLevelLabel;
  const cameraBrandLabel = (code?: string | null) => (code ? cameraBrandOptions.find((o) => o.value.toLowerCase() === code.toLowerCase())?.label ?? code : '—');
  const cameraTypeLabel = (code?: string | null) => (code ? cameraTypeOptions.find((o) => o.value === code)?.label ?? code : '—');

  // Which columns this person wants, in this browser. The ones a CCTV operator rarely needs start hidden.
  const columnsKey = `cctv_camera_columns:${(user as any)?.id ?? (user as any)?.username ?? 'anon'}`;
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(columnsKey) ?? 'null');
      return Array.isArray(saved) ? saved : ['cameraModel', 'alertLevel', 'retentionPolicy', 'lastPoll', 'dateAdded', 'createdBy'];
    } catch {
      return ['cameraModel', 'alertLevel', 'retentionPolicy', 'lastPoll', 'dateAdded', 'createdBy'];
    }
  });
  const showColumn = (key: string) => !hiddenColumns.includes(key);
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
  // Arriving from a place, e.g. /cctv/cameras?site=…&zone=…
  const [urlParams, setUrlParams] = useSearchParams();
  const siteParam = urlParams.get('site');
  const zoneParam = urlParams.get('zone');
  const inUseOnly = urlParams.get('on') === '1';
  const stateParam = urlParams.get('state');
  const typeParam = urlParams.get('type');
  const brandParam = urlParams.get('brand');
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [cameraPick, setCameraPick] = useState<{ ids: string[]; onlyOffline: boolean }>({ ids: [], onlyOffline: false });

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, cameraPick]);
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [modal, setModal] = useState<{ open: boolean; item?: any | null }>({ open: false });
  const [formState, setForm] = useState(emptyForm());
  const form = formState;
  // Result of POST /cameras/detect-stream for the connection fields as they were when it ran.
  const [detect, setDetect] = useState<{ state: 'idle' | 'running' | 'found' | 'auth_failed' | 'unreachable' | 'not_found'; key?: string; video?: any }>({ state: 'idle' });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { data: brandTemplates = [] } = useQuery({
    queryKey: ['device-templates'],
    queryFn: () => imageServiceApi.getDeviceTemplates(),
    staleTime: Infinity,
  });
  const brandTemplate = (brandTemplates as any[]).find((b: any) => b.brand === form.brand);
  const connKey = [form.ipAddress.trim(), form.username.trim(), form.password, form.brand, form.rtspPort, form.channel].join('|');
  const [submitting, setSubmitting] = useState(false);

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

  const { data: cameraStatusesRaw } = useQuery({
    queryKey: ['masterdata-camera-statuses'],
    queryFn: () => imageServiceApi.getMasterdata({ type: 'camera_status' }, { silent403: true }),
    staleTime: 1000 * 60 * 5,
    enabled: hasMasterdataPermission,
  });
  const cameraStatuses = (cameraStatusesRaw?.data ?? cameraStatusesRaw ?? []) as any[];

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
      ...(tpl ? { retentionPolicyId: tpl.retentionPolicyId || p.retentionPolicyId } : {})
    }));
  };

  const openCreate = () => {
    const defaultTemplate = templates.find((t: any) => t.isDefault && t.isActive);
    const formInit = emptyForm();
    if (defaultTemplate) {
      formInit.templateId = defaultTemplate.id;
      if (defaultTemplate.retentionPolicyId) {
        formInit.retentionPolicyId = defaultTemplate.retentionPolicyId;
      }
    }
    const defaultRetention = policies.find((rp: any) => rp.isDefault);
    if (defaultRetention) {
      formInit.retentionPolicyId = defaultRetention.id;
    }
    setDetect({ state: 'idle' });
    setShowAdvanced(false);
    setForm(formInit);
    setModal({ open: true, item: null });
  };
  const formFromCamera = (item: any) => {
    // Cameras saved through the simple setup keep brand/port/channel/username (never the password) in metadata.
    const conn = item.metadata?.connection;
    return {
      name: item.name, ipAddress: item.ipAddress ?? '',
      retentionPolicyId: item.retentionPolicyId ?? '', description: item.description ?? '',
      rtspUrl: item.rtspUrl ?? '', rtspUrlSub: item.rtspUrlSub ?? '', streamPath: item.streamPath ?? '',
      templateId: item.templateId ?? '',
      slaTargetPercent: item.slaTargetPercent != null ? String(item.slaTargetPercent) : '',
      connMode: (conn || !item.rtspUrl ? 'simple' : 'manual') as 'simple' | 'manual',
      brand: conn?.brand ?? 'auto', rtspPort: String(conn?.port ?? 554), channel: String(conn?.channel ?? 1),
      username: conn?.username ?? 'admin', password: '',
      recordingMode: (item.recordingMode === 'continuous' ? 'continuous' : 'live_only') as 'live_only' | 'continuous',
      cameraType: item.cameraType ?? '', cameraBrand: item.cameraBrand ?? '', cameraModel: item.cameraModel ?? '', shortCode: item.shortCode ?? '', alertLevel: item.alertLevel ?? '',
      siteId: item.siteId ?? '', zoneId: item.zoneId ?? '', locationFromDevice: item.locationFromDevice !== false,
      enabled: item.enabled !== false,
    };
  };

  const openEdit = (item: any) => {
    setDetect({ state: 'idle' });
    setShowAdvanced(false);
    setForm(formFromCamera(item));
    setModal({ open: true, item });
  };

  // A clone gets a new name and no stream path (it must be unique), and must not reuse a redacted URL.
  // Opened from elsewhere, e.g. the live room: edit that camera at once, and return there when done.
  const returnWhenClosed = useRef(false);
  const editParam = urlParams.get('edit');
  useEffect(() => {
    if (!editParam || isLoading) return;
    const target = (cameras as any[]).find((c) => c.id === editParam);
    returnWhenClosed.current = urlParams.get('back') === '1';
    setUrlParams({}, { replace: true });
    if (target) openEdit(target);
    else toast.error(t('imageService.cameras.notFound'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, isLoading, cameras]);
  const modalWasOpen = useRef(false);
  useEffect(() => {
    if (modalWasOpen.current && !modal.open && returnWhenClosed.current) {
      returnWhenClosed.current = false;
      navigate(-1);
    }
    modalWasOpen.current = modal.open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal.open]);

  const openClone = (item: any) => {
    const f = formFromCamera(item);
    setForm({
      ...f,
      name: getUniqueCloneName(item.name),
      streamPath: '',
      rtspUrl: isRedactedRtsp(f.rtspUrl) ? '' : f.rtspUrl,
      rtspUrlSub: isRedactedRtsp(f.rtspUrlSub) ? '' : f.rtspUrlSub,
    });
    setModal({ open: true, item: null });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let form = formState;
    // A new camera needs a stream source; on edit a redacted URL means "unchanged".
    const simple = form.connMode === 'simple';
    if (!form.name) {
      toast.warning(t('common.requiredFields')); return;
    }
    // Both live under "more settings", so open it: otherwise nothing on screen shows what is missing.
    if (!simple && !modal.item && !form.rtspUrl) {
      setShowAdvanced(true);
      toast.warning(t('common.requiredFields')); return;
    }
    // Only recordings kept on this server need a policy. A camera that is only watched keeps no files here,
    // and channels created from a DVR/NVR have none, so asking for it stopped them being saved at all.
    if (form.recordingMode === 'continuous' && !form.retentionPolicyId) {
      setShowAdvanced(true);
      toast.warning(t('imageService.cameras.retentionNeededForRecording')); return;
    }
    if (simple && !form.ipAddress.trim()) {
      toast.warning(t('imageService.cameras.conn.ipRequired')); return;
    }
    // A new camera (including a clone) has no stored password to fall back on.
    if (simple && !modal.item && form.username.trim() && !form.password) {
      toast.warning(t('imageService.cameras.conn.passwordRequired')); return;
    }
    // "Auto" has to be resolved to a real brand by opening the stream; a brand picked by hand is
    // saved as-is (e.g. a camera that is not on the network yet).
    if (simple && form.brand === 'auto') {
      const detected = detect.state === 'found' && detect.key === connKey ? form : await runDetect();
      if (!detected) return;
      form = detected;
    }
    const isNameDuplicate = cameras.some((c: any) => c.id !== modal.item?.id && c.name.trim().toLowerCase() === form.name.trim().toLowerCase());
    if (isNameDuplicate) {
      toast.error(t('imageService.cameras.validation.nameDuplicateError'));
      return;
    }
    // Enforce admin-configured required fields for the camera form (only fields
    // that have an input in this modal).
    // In simple mode the RTSP URLs are generated, so they always count as filled in.
    const cameraFormKeys = ['name', 'ipAddress', 'streamPath', 'retentionPolicyId', 'templateId', 'description',
      ...(simple ? [] : ['rtspUrl', 'rtspUrlSub'])];
    for (const fd of catalogFieldsFor('camera')) {
      if (!cameraFormKeys.includes(fd.key) || !isCameraFieldRequired(fd.key)) continue;
      // A camera that is only watched keeps no files on this server, so it has nothing for a policy to govern.
      if (fd.key === 'retentionPolicyId' && form.recordingMode !== 'continuous') continue;
      const val = (form as any)[fd.key];
      const empty = val === undefined || val === null
        || (typeof val === 'string' && val.trim() === '')
        || (Array.isArray(val) && val.length === 0);
      // Most of these live under "more settings": open it, so the empty field can be seen.
      if (empty) { setShowAdvanced(true); toast.warning(t('imageService.requiredFields.missingField', { field: t(fd.labelKey) })); return; }
    }
    try {
      setSubmitting(true);
      const buildPayload = () => {
        const payload: Record<string, unknown> = {
          name: form.name,
          ipAddress: form.ipAddress || null,
          retentionPolicyId: form.retentionPolicyId || null,
          description: form.description,
          templateId: form.templateId || null,
          slaTargetPercent: form.slaTargetPercent === '' ? null : parseFloat(form.slaTargetPercent),
          recordingMode: form.recordingMode,
          cameraType: form.cameraType || null,
          cameraBrand: form.cameraBrand || null,
          cameraModel: form.cameraModel.trim() || null,
          shortCode: form.shortCode.trim() || null,
          alertLevel: form.alertLevel || null,
          ...(modal.item ? { enabled: form.enabled } : {}),
          ...(modal.item?.deviceId && form.locationFromDevice
            ? { locationFromDevice: true }
            : { locationFromDevice: false, siteId: form.siteId || null, zoneId: form.zoneId || null }),
        };
        if (simple) {
          payload.connection = {
            brand: form.brand,
            port: parseInt(form.rtspPort, 10) || 554,
            channel: parseInt(form.channel, 10) || 1,
            username: form.username.trim(),
            // Blank on edit keeps the stored password.
            ...(form.password ? { password: form.password } : {}),
          };
        } else {
          payload.rtspUrl = form.rtspUrl || null;
          payload.rtspUrlSub = form.rtspUrlSub || null;
        }
        // Leave the stream path to the server when blank; it is unique and drives MediaMTX.
        if (form.streamPath) payload.streamPath = form.streamPath;
        return payload;
      };
      if (modal.item) {
        await imageServiceApi.updateCamera(modal.item.id, buildPayload());
        toast.success(t('imageService.cameras.updated'));
      } else {
        await imageServiceApi.createCamera(buildPayload());
        toast.success(t('imageService.cameras.created'));
      }
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      queryClient.invalidateQueries({ queryKey: ['cctv-device'] });
      queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
      setModal({ open: false });
    } catch (e: any) { if (!e?._handled) toast.error(cameraErrorMessage(e, t)); }
    finally { setSubmitting(false); }
  };

  /** Finds brand/port/channel by opening the stream; returns the form values to save with, or null. */
  const runDetect = async (): Promise<typeof form | null> => {
    if (!form.ipAddress.trim()) { toast.warning(t('imageService.cameras.conn.ipRequired')); return null; }
    setDetect({ state: 'running' });
    try {
      const r = await imageServiceApi.detectCameraStream({
        ipAddress: form.ipAddress.trim(),
        username: form.username.trim(),
        ...(form.password ? { password: form.password } : {}),
        brand: form.brand,
        port: parseInt(form.rtspPort, 10) || 554,
        channel: parseInt(form.channel, 10) || 1,
        ...(modal.item ? { cameraId: modal.item.id } : {}),
      });
      if (r?.status !== 'found') {
        setDetect({ state: r?.status ?? 'not_found' });
        if (r?.status === 'not_found') setShowAdvanced(true);
        return null;
      }
      const next = { ...form, brand: r.brand, rtspPort: String(r.port), channel: String(r.channel) };
      setForm(next);
      setDetect({ state: 'found', video: r.video, key: [next.ipAddress.trim(), next.username.trim(), next.password, next.brand, next.rtspPort, next.channel].join('|') });
      return next;
    } catch (e: any) {
      setDetect({ state: 'idle' });
      if (!e?._handled) toast.error(t('common.error'));
      return null;
    }
  };

  const handleDeactivate = async (id: string) => {
    try {
      await imageServiceApi.deactivateCamera(id);
      toast.success(t('imageService.cameras.deactivated'));
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
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
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
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
        const uniqueName = getUniqueCloneName(item.name, newlyCreatedNames);
        newlyCreatedNames.add(uniqueName.trim().toLowerCase());
        // Redacted RTSP URLs cannot be copied; such clones are created without a stream source.
        const payload = {
          name: uniqueName,
          ipAddress: item.ipAddress ?? null,
          retentionPolicyId: item.retentionPolicyId,
          description: item.description ?? '',
          cameraType: item.cameraType ?? null,
          cameraBrand: item.cameraBrand ?? null,
          cameraModel: item.cameraModel ?? null,
          templateId: item.templateId || null,
          rtspUrl: isRedactedRtsp(item.rtspUrl) ? null : item.rtspUrl ?? null,
          rtspUrlSub: isRedactedRtsp(item.rtspUrlSub) ? null : item.rtspUrlSub ?? null,
          slaTargetPercent: item.slaTargetPercent != null ? parseFloat(item.slaTargetPercent) : null,
        };
        await imageServiceApi.createCamera(payload);
        successCount++;
      }
      toast.success(t('imageService.cameras.createdBulk', { count: successCount }));
      setSelectedIds(new Set());
      setBulkCloneModal({ open: false });
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
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
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
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
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
    } catch (e: any) {
      if (!e?._handled) toast.error(cameraErrorMessage(e, t));
      fetchCameraTrash();
    } finally { setTrashBulkRestoring(false); }
  }, [trashSelected, t, toast, queryClient, fetchCameraTrash]);

  const { data: oneImpact } = useDeletionImpact(permaDeleteTarget ? [permaDeleteTarget.id] : [], !!permaDeleteTarget);
  const { data: selectedImpact } = useDeletionImpact(Array.from(trashSelected), showBulkDeleteTrashConfirm);
  const { data: allTrashImpact } = useDeletionImpact((trashData as any[]).map((c) => c.id), showEmptyConfirm);
  const deletionError = (e: any) => {
    if (e?.response?.status === 401) return t('imageService.cameras.wrongPassword');
    if (e?.response?.data?.details?.code === 'CAMERA_LEGAL_HOLD') return t('imageService.cameras.deletionHeld', { n: e.response.data.details.legalHold });
    return t('common.error');
  };

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
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
    } catch (e: any) {
      if (e?.response?.status === 401 || e?.response?.status === 409 || !e?._handled) toast.error(deletionError(e));
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
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
    } catch (e: any) { if (!e?._handled) toast.error(cameraErrorMessage(e, t)); }
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
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
    } catch (e: any) {
      if (!e?._handled) toast.error(cameraErrorMessage(e, t));
      fetchCameraTrash();
    } finally { setRestoringAllTrash(false); }
  }, [filteredTrashData, t, toast, queryClient, fetchCameraTrash]);

  const handleEmptyCameraTrash = useCallback(async () => {
    if (!emptyTrashPassword) return;
    try {
      const result = await imageServiceApi.emptyCameraTrash(emptyTrashPassword);
      toast.success(t('imageService.cameras.emptyCameraTrashSuccess', { count: result.deleted }));
      if (result.keptForLegalHold > 0) toast.warning(t('imageService.cameras.deletionKept', { n: result.keptForLegalHold }));
      setShowEmptyConfirm(false);
      setEmptyTrashPassword('');
      fetchCameraTrash();
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
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
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
    } catch (e: any) {
      if (e?.response?.status === 401 || e?.response?.status === 409 || !e?._handled) toast.error(deletionError(e));
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
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
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
      queryClient.invalidateQueries({ queryKey: ['cameras-list'] }); queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-open-incidents-count'] });
    } catch (e: any) { if (!e?._handled) toast.error(t('common.error')); }
    finally {
      setChangingStatus(prev => { const next = new Set(prev); next.delete(camera.id); return next; });
    }
  };

  const retentionLabel = (policyId?: string | null): string => {
    const p = (policies as any[]).find((rp: any) => rp.id === policyId);
    if (!p) return '';
    const nameMap: Record<string, string> = {
      'Default Retention': 'imageService.retention.defaultName',
      'Long-Term Retention': 'imageService.retention.longTermName',
      'การจัดเก็บเริ่มต้น (Default)': 'imageService.retention.defaultName',
      'การจัดเก็บระยะยาว (Long-Term)': 'imageService.retention.longTermName',
    };
    return nameMap[p.name] ? t(nameMap[p.name]) : p.name;
  };

  // Everything a column can show, hidden or not, as it reads on screen.
  const searchTextOf = (c: any) => [
    cameraSearchText(c, t(`imageService.cameras.${c.status}`)),
    cameraTypeLabel(c.cameraType),
    cameraBrandLabel(c.cameraBrand),
    c.retentionPolicy?.name,
    retentionLabel(c.retentionPolicyId),
    c.createdBy,
    c.operationalStatus === 'offline' ? t(`imageService.cameras.offlineReason.${c.operationalReason ?? 'unknown'}`) : '',
    c.enabled === false ? t('imageService.cameras.switchedOff') : '',
    c.lastPolledAt ? formatDateTime(c.lastPolledAt, i18n.language) : '',
    c.createdAt ? formatDateTime(c.createdAt, i18n.language) : '',
  ].filter(Boolean).join(' ').normalize('NFC').toLocaleLowerCase();
  const filterableCameras = inUseOnly ? (cameras as any[]).filter((c: any) => c.enabled !== false) : (cameras as any[]);
  const filtered = applyLocationFilter(applyCameraSelection(cameras as any[], cameraPick.ids, cameraPick.onlyOffline), siteParam ? [siteParam] : [], zoneParam ? [zoneParam] : [])
    .filter((c: any) => stateParam !== 'problem' || (c.enabled !== false && c.operationalStatus !== 'online'))
    .filter((c: any) => stateParam !== 'off' || c.enabled === false)
    .filter((c: any) => !typeParam || (typeParam === 'none' ? !c.cameraType : c.cameraType === typeParam))
    .filter((c: any) => !brandParam || (brandParam === 'none' ? !c.cameraBrand : c.cameraBrand?.toLowerCase() === brandParam.toLowerCase()))
    .filter((c: any) => (!inUseOnly || c.enabled !== false) && (!search.trim() || matchesCameraQuery(searchTextOf(c), search)));
  const { data: devicesForSummary = [] } = useQuery<any[]>({ queryKey: ['cctv-devices'], queryFn: () => imageServiceApi.getDevices() });
  const listStats = useMemo(() => summarizeCameraList(filtered, devicesForSummary), [filtered, devicesForSummary]);
  const locationChip = (() => {
    const notSpecified = t('ui.cctvDashboard.notSpecified');
    if (typeParam) return `${t('imageService.cameras.cameraType')}: ${typeParam === 'none' ? notSpecified : cameraTypeOptions.find((o) => o.value === typeParam)?.label ?? typeParam}`;
    if (brandParam) return `${t('imageService.cameras.cameraBrand')}: ${brandParam === 'none' ? notSpecified : cameraBrandLabel(brandParam)}`;
    if (!siteParam && !zoneParam) return null;
    const anyCamera = (cameras as any[]).find((c) => (siteParam && c.siteId === siteParam) || (zoneParam && c.zoneId === zoneParam));
    const zoneName = zoneParam === NO_LOCATION ? t('ui.location.noZoneLabel') : (cameras as any[]).find((c) => c.zoneId === zoneParam)?.zone?.name;
    const stateName = stateParam === 'problem' ? t('ui.location.stateProblem') : stateParam === 'off' ? t('imageService.cameras.switchedOff') : null;
    return [siteParam ? anyCamera?.site?.name : null, zoneName, stateName].filter(Boolean).join(' / ') || '—';
  })();

  const getSortValue = (camera: any, col: string) => {
    switch (col) {
      case 'retentionPolicy': {
        const p = (policies as any[]).find((rp: any) => rp.id === camera.retentionPolicyId);
        return p?.name ?? '';
      }
      case 'lastPoll':
        return camera.lastPolledAt ?? '';
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
    cameraType: cameraTypeLabel(camera.cameraType),
    cameraBrand: cameraBrandLabel(camera.cameraBrand),
    cameraModel: camera.cameraModel ?? '',
    alertLevel: alertLevelLabel(camera.alertLevel) ?? inheritedAlertLevelLabel(camera.device),
    description: camera.description ?? '',
    device: camera.device?.name ?? '',
    site: camera.site?.name ?? '',
    zone: camera.zone?.name ?? '',
    status: camera.status,
    lastPolledAt: camera.lastPolledAt ? new Date(camera.lastPolledAt).toLocaleString() : '-',
    createdAt: camera.createdAt ? formatDateTime(camera.createdAt, i18n.language) : '-',
    createdBy: camera.createdBy || '-',
  })), [sorted, i18n.language, cameraTypeOptions, cameraBrandOptions, alertLevelOptions]);

  const cameraColumns = [
    { key: 'cameraType', label: t('imageService.cameras.cameraType') },
    { key: 'cameraBrand', label: t('imageService.cameras.cameraBrand') },
    { key: 'cameraModel', label: t('imageService.cameras.cameraModel') },
    { key: 'alertLevel', label: t('imageService.cameras.alertLevel') },
    { key: 'description', label: t('imageService.cameras.description') },
    { key: 'device', label: t('imageService.cameras.columnDevice') },
    { key: 'site', label: t('ui.location.site') },
    { key: 'zone', label: t('ui.location.zone') },
    { key: 'ipAddress', label: t('imageService.cameras.ipAddress') },
    { key: 'retentionPolicy', label: t('imageService.cameras.retentionPolicy') },
    { key: 'status', label: t('imageService.cameras.status') },
    { key: 'lastPoll', label: t('imageService.cameras.lastPoll') },
    { key: 'dateAdded', label: t('imageService.cameras.dateAdded') },
    { key: 'createdBy', label: t('imageService.cameras.createdBy') },
  ];

  const cameraExportColumns = [
    { key: 'no', label: '#' },
    { key: 'name', label: t('imageService.cameras.cameraName') },
    { key: 'ipAddress', label: t('imageService.cameras.ipAddress') },
    { key: 'cameraType', label: t('imageService.cameras.cameraType') },
    { key: 'cameraBrand', label: t('imageService.cameras.cameraBrand') },
    { key: 'cameraModel', label: t('imageService.cameras.cameraModel') },
    { key: 'alertLevel', label: t('imageService.cameras.alertLevel') },
    { key: 'description', label: t('imageService.cameras.description') },
    { key: 'device', label: t('imageService.cameras.columnDevice') },
    { key: 'site', label: t('ui.location.site') },
    { key: 'zone', label: t('ui.location.zone') },
    { key: 'status', label: t('imageService.cameras.status') },
    { key: 'lastPolledAt', label: t('imageService.cameras.lastPoll') },
    { key: 'createdAt', label: t('imageService.cameras.dateAdded') },
    { key: 'createdBy', label: t('imageService.cameras.createdBy') },
  ];

  const isNameDuplicate = form.name ? cameras.some((c: any) => c.id !== modal.item?.id && c.name.trim().toLowerCase() === form.name.trim().toLowerCase()) : false;
  const ipDupCamera = form.ipAddress ? cameras.find((c: any) => c.id !== modal.item?.id && (c.ipAddress ?? '').trim() === form.ipAddress.trim() && !(c.deviceId && c.deviceId === modal.item?.deviceId)) : null;

  return (
    <div className="pt-6 px-6 pb-2.5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            iSmart CCTV · {t('imageService.cameras.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.cameras.title')}</h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <ColumnSelector
            align="left"
            reorderable={false}
            label={t('imageService.cameras.columns')}
            columns={cameraColumns}
            order={cameraColumns.map((c) => c.key)}
            hidden={hiddenColumns}
            onChange={(_order, hidden) => {
              setHiddenColumns(hidden);
              try {
                localStorage.setItem(columnsKey, JSON.stringify(hidden));
              } catch {
                // Only a convenience: the choice still applies for this visit.
              }
            }}
          />
          <div data-camera-pick>
            <CameraFilterDropdown cameras={filterableCameras} selectedIds={cameraPick.ids} onlyOffline={cameraPick.onlyOffline} onApply={(ids, onlyOffline) => setCameraPick({ ids, onlyOffline })} />
          </div>
          <div className="relative">
            <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${themeConfig.text.secondary}`} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('imageService.cameras.searchAllColumns')}
              title={t('imageService.cameras.searchAllColumns')}
              className={`pl-8 pr-3 py-1.5 w-64 rounded-lg text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} w-52`} />
          </div>
          {locationChip && (
            <button
              type="button"
              onClick={() => setUrlParams({})}
              title={t('ui.location.clearFilter')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/25"
            >
              <span>{locationChip}</span>
              <X size={12} />
            </button>
          )}
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
              {canUpdate && (
                <Button size="sm" onClick={() => setBulkEditOpen(true)}>
                  <Edit size={12} className="mr-1" /> {t('ui.bulkEdit.button')}
                </Button>
              )}
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
              {canDelete && (
                <button onClick={handleOpenCameraTrash}
                  className="px-3 py-2 rounded-md text-xs flex items-center gap-1.5 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">
                  <Trash2 size={13} /> {t('imageService.cameras.cameraTrash')}
                </button>
              )}
            </>
          )}
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
      </div>

      <div ref={contentRef}>
      {isLoading ? <TableSkeleton rows={8} /> : (
        <div className={`${themeConfig.card} rounded-lg overflow-hidden flex flex-col`}>
          <div className="overflow-x-auto overflow-y-auto relative" style={{ height: 'calc(100vh - 265px)', maxHeight: 'calc(100vh - 265px)' }}>
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
                {showColumn('cameraType') && <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.cameraType')}</th>}
                {showColumn('cameraBrand') && <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.cameraBrand')}</th>}
                {showColumn('cameraModel') && <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.cameraModel')}</th>}
                {showColumn('alertLevel') && <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.alertLevel')}</th>}
                {showColumn('description') && <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.description')}</th>}
                {showColumn('device') && <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.cameras.columnDevice')}</th>}
                {showColumn('site') && <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('ui.location.site')}</th>}
                {showColumn('zone') && <th className={`px-4 py-3 text-left text-sm font-semibold ${themeConfig.text.primary}`}>{t('ui.location.zone')}</th>}
                {showColumn('ipAddress') && (
                <th onClick={() => handleSort('ipAddress')} className={thCls('ipAddress')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.ipAddress')}
                    {sortCol === 'ipAddress' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                )}
                {showColumn('retentionPolicy') && (
                <th onClick={() => handleSort('retentionPolicy')} className={thCls('retentionPolicy')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.retentionPolicy')}
                    {sortCol === 'retentionPolicy' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                )}
                {showColumn('status') && (
                <th onClick={() => handleSort('status')} className={thCls('status')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.status')}
                    {sortCol === 'status' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                )}
                {showColumn('lastPoll') && (
                <th onClick={() => handleSort('lastPoll')} className={thCls('lastPoll')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.lastPoll')}
                    {sortCol === 'lastPoll' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                )}
                {showColumn('dateAdded') && (
                <th onClick={() => handleSort('dateAdded')} className={thCls('dateAdded')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.dateAdded')}
                    {sortCol === 'dateAdded' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                )}
                {showColumn('createdBy') && (
                <th onClick={() => handleSort('createdBy')} className={thCls('createdBy')}>
                  <div className="flex items-center gap-1">{t('imageService.cameras.createdBy')}
                    {sortCol === 'createdBy' ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" /> : <ChevronsUpDown size={11} className="opacity-25" />}</div>
                </th>
                )}
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
                        {camera.recordingMode === 'continuous' ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">● {t('imageService.cameras.recording.badgeRecord')}</span>
                        ) : (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border border-white/10 ${themeConfig.text.secondary}`}>{t('imageService.cameras.recording.badgeLive')}</span>
                        )}
                      </div>
                    </td>
                    {showColumn('cameraType') && <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{cameraTypeLabel(camera.cameraType)}</td>}
                    {showColumn('cameraBrand') && <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{cameraBrandLabel(camera.cameraBrand)}</td>}
                    {showColumn('cameraModel') && <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{camera.cameraModel || '—'}</td>}
                    {showColumn('alertLevel') && <td data-camera-level-cell className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{alertLevelLabel(camera.alertLevel) ?? <span className="opacity-70">{inheritedAlertLevelLabel(camera.device)}</span>}</td>}
                    {showColumn('description') && <td className={`px-4 py-3 text-sm max-w-xs truncate ${themeConfig.text.secondary}`} title={camera.description ?? ''}>{camera.description || '—'}</td>}
                    {showColumn('device') && <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{camera.device?.name ?? '—'}</td>}
                    {showColumn('site') && <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{camera.site?.name ?? '—'}</td>}
                    {showColumn('zone') && <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{camera.zone?.name ?? '—'}</td>}
                    {showColumn('ipAddress') && <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>{camera.ipAddress}</td>}
                    {showColumn('retentionPolicy') && (
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {retentionLabel(camera.retentionPolicyId) || '—'}
                    </td>
                    )}
                    {showColumn('status') && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${OPERATIONAL_STATUS_DOT[camera.operationalStatus] ?? OPERATIONAL_STATUS_DOT.unknown}`}
                          title={`${t('imageService.cameras.operationalStatus')}: ${t(`imageService.cameras.operational.${camera.operationalStatus ?? 'unknown'}`)}${camera.operationalStatus === 'offline' ? ` (${t(`imageService.cameras.offlineReason.${camera.operationalReason ?? 'unknown'}`)})` : ''}`}
                        />
                        {camera.enabled !== false && (
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
                        )}
                        {camera.enabled !== false && camera.operationalStatus === 'offline' && (
                          <span className="text-[10px] text-rose-300 whitespace-nowrap">{t(`imageService.cameras.offlineReason.${camera.operationalReason ?? 'unknown'}`)}</span>
                        )}
                        {camera.enabled === false && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] border border-slate-600 text-slate-400">{t('imageService.cameras.switchedOff')}</span>
                        )}
                      </div>
                    </td>
                    )}
                    {showColumn('lastPoll') && (
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {camera.lastPolledAt ? formatDateTime(camera.lastPolledAt, i18n.language) : '—'}
                    </td>
                    )}
                    {showColumn('dateAdded') && (
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {camera.createdAt ? formatDateTime(camera.createdAt, i18n.language) : '—'}
                    </td>
                    )}
                    {showColumn('createdBy') && (
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {camera.createdBy || '—'}
                    </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
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
            <span className="ml-2 px-2 py-1 rounded bg-white/5 border border-white/10">
              <LocationStatsLine stats={listStats} />
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
                {t('imageService.cameras.ipAddress')}{cameraStar('ipAddress')}
              </label>
              <input value={form.ipAddress} onChange={e => setForm(p => ({ ...p, ipAddress: e.target.value }))}
                placeholder={t('imageService.cameras.ipExample')}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${ipDupCamera ? 'border-yellow-500 focus:ring-yellow-500/50' : themeConfig.inputBorder} ${themeConfig.text.primary}`} />
              <p className={`text-[10px] mt-0.5 ${themeConfig.text.secondary}`}>
                {t('imageService.cameras.ipExample')}
              </p>
              {ipDupCamera && (
                <p className="text-xs text-yellow-400 mt-1">
                  {t('imageService.cameras.validation.ipDuplicateWarning', { name: ipDupCamera.name })}
                </p>
              )}
            </div>
            {form.connMode === 'simple' && (
              <>
                <div>
                  <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.cameras.conn.username')}</label>
                  <input value={form.username} autoComplete="off"
                    onChange={e => { setDetect({ state: 'idle' }); setForm(p => ({ ...p, username: e.target.value })); }}
                    className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.cameras.conn.password')}</label>
                  <input type="password" value={form.password} autoComplete="new-password"
                    placeholder={modal.item ? t('imageService.cameras.conn.passwordKeep') : ''}
                    onChange={e => { setDetect({ state: 'idle' }); setForm(p => ({ ...p, password: e.target.value })); }}
                    className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
                </div>
                <div className="col-span-2">
                  <Button type="button" variant="secondary" onClick={() => { void runDetect(); }} disabled={detect.state === 'running'}>
                    {detect.state === 'running' ? t('imageService.cameras.conn.testing') : t('imageService.cameras.conn.test')}
                  </Button>
                  {detect.state === 'found' && detect.key === connKey && (
                    <p className="text-xs text-emerald-400 mt-1.5">
                      {t('imageService.cameras.conn.found', { brand: (brandTemplates as any[]).find((b: any) => b.brand === form.brand)?.label ?? form.brand })}
                      {detect.video?.width ? ` · ${String(detect.video.codec ?? '').toUpperCase()} ${detect.video.width}×${detect.video.height}` : ''}
                    </p>
                  )}
                  {detect.state === 'auth_failed' && <p className="text-xs text-red-400 mt-1.5">{t('imageService.cameras.conn.authFailed')}</p>}
                  {detect.state === 'unreachable' && <p className="text-xs text-red-400 mt-1.5">{t('imageService.cameras.conn.unreachable', { ip: form.ipAddress })}</p>}
                  {detect.state === 'not_found' && <p className="text-xs text-amber-400 mt-1.5">{t('imageService.cameras.conn.notFound')}</p>}
                  {detect.state === 'idle' && <p className={`text-[11px] mt-1.5 ${themeConfig.text.secondary}`}>{t('imageService.cameras.conn.detectHint')}</p>}
                </div>
              </>
            )}
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <label className={`text-sm font-medium ${themeConfig.text.primary}`}>{t('imageService.cameras.cameraType')}</label>
                {hasMasterdataPermission && (
                  <a href="/cctv/masterdata?type=camera_type" onClick={(e) => { e.preventDefault(); navigate('/cctv/masterdata?type=camera_type'); }} className="text-xs text-cyan-400 hover:text-cyan-300">{t('imageService.cameras.manageList')}</a>
                )}
              </div>
              <SearchableSelect value={form.cameraType} showSearch={false} onChange={v => setForm(p => ({ ...p, cameraType: v }))}
                options={[{ value: '', label: t('imageService.cameras.cameraTypeNone') }, ...cameraTypeOptions.map((o) => ({ value: o.value, label: o.label }))]} />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.cameras.cameraBrand')}</label>
              <SearchableSelect value={form.cameraBrand} onChange={v => setForm(p => ({ ...p, cameraBrand: v }))}
                options={[{ value: '', label: t('imageService.cameras.cameraTypeNone') }, ...cameraBrandOptions.map((o) => ({ value: o.value, label: o.label })), ...(form.cameraBrand && !cameraBrandOptions.some((o) => o.value === form.cameraBrand) ? [{ value: form.cameraBrand, label: form.cameraBrand }] : [])]} />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.cameras.cameraModel')}</label>
              <input value={form.cameraModel} maxLength={64} onChange={e => setForm(p => ({ ...p, cameraModel: e.target.value }))}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.cameras.alertLevel')}</label>
              <div data-camera-alert-level>
                <SearchableSelect value={form.alertLevel} onChange={(v) => setForm(p => ({ ...p, alertLevel: v }))} showSearch={false}
                  options={[
                    { value: '', label: modal.item?.deviceId
                      ? t('imageService.cameras.alertLevelFromDevice', { level: inheritedAlertLevelLabel(modal.item?.device) })
                      : t('imageService.cameras.alertLevelDefault', { level: defaultAlertLevelLabel }) },
                    ...alertLevelOptions.map((o) => ({ value: o.value, label: o.label })),
                  ]} />
              </div>
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.cameras.shortCode')}</label>
              <input data-camera-short-code value={form.shortCode} maxLength={20} onChange={e => setForm(p => ({ ...p, shortCode: cleanShortCode(e.target.value) }))}
                placeholder={modal.item?.device?.shortCode ? t('imageService.cameras.shortCodeFromDevice', { code: modal.item.device.shortCode }) : ''}
                title={t('imageService.cameras.shortCodeHint')}
                className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
              <p className={`mt-1 text-xs ${themeConfig.text.secondary}`}>{t('imageService.cameras.shortCodeHint')}</p>
            </div>
            <p className={`col-span-2 -mt-1 text-xs ${themeConfig.text.secondary}`}>{t('imageService.cameras.cameraInfoHint')}</p>
            <div className="col-span-2 space-y-2">
              {modal.item?.deviceId && (
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={form.locationFromDevice} onChange={e => setForm(p => ({ ...p, locationFromDevice: e.target.checked }))} className="mt-0.5 w-4 h-4 accent-cyan-500" />
                  <span className={`text-sm ${themeConfig.text.primary}`}>
                    {t('ui.location.fromDevice')}
                    <span className={`block text-xs ${themeConfig.text.secondary}`}>{[modal.item.device?.site?.name, modal.item.device?.zone?.name].filter(Boolean).join(' / ') || t('ui.location.deviceHasNone')}</span>
                  </span>
                </label>
              )}
              {(!modal.item?.deviceId || !form.locationFromDevice) && (
                <LocationFields siteId={form.siteId} zoneId={form.zoneId} labelClass={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}
                  onChange={(next) => setForm(p => ({ ...p, ...next }))} />
              )}
            </div>
            {modal.item && (
              <label className="col-span-2 flex items-start gap-3 cursor-pointer select-none pt-1">
                <input type="checkbox" checked={form.enabled} onChange={e => setForm(p => ({ ...p, enabled: e.target.checked }))} className="mt-0.5 w-4 h-4 accent-cyan-500" />
                <span className={`text-sm font-medium ${themeConfig.text.primary}`}>
                  {t('imageService.cameras.enabledField')}
                  <span className={`block text-xs font-normal ${themeConfig.text.secondary}`}>{t('imageService.cameras.enabledHint')}</span>
                </span>
              </label>
            )}
            <label className="col-span-2 flex items-start gap-3 cursor-pointer select-none pt-1">
              <input type="checkbox" checked={form.recordingMode === 'continuous'}
                onChange={e => setForm(p => ({ ...p, recordingMode: e.target.checked ? 'continuous' : 'live_only' }))}
                className="w-4 h-4 mt-0.5 rounded accent-red-500" />
              <span>
                <span className={`block text-sm font-medium ${themeConfig.text.primary}`}>{t('imageService.cameras.recording.toggle')}</span>
                <span className={`block text-[11px] mt-0.5 ${themeConfig.text.secondary}`}>
                  {form.recordingMode === 'continuous' ? t('imageService.cameras.recording.onHint') : t('imageService.cameras.recording.offHint')}
                </span>
              </span>
            </label>
            <button type="button" className="col-span-2 flex items-center gap-1 text-left text-xs text-cyan-400 hover:underline"
              onClick={() => setShowAdvanced(v => !v)}>
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {t('imageService.cameras.conn.advanced')}
            </button>
          </div>

          {showAdvanced && (
          <div className="grid grid-cols-2 gap-3 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            {form.connMode === 'simple' ? (
              <>
                <div className="col-span-2">
                  <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.cameras.conn.brand')}</label>
                  <SearchableSelect value={form.brand} showSearch={false}
                    onChange={v => { setDetect({ state: 'idle' }); setForm(p => ({ ...p, brand: v })); }}
                    options={[{ value: 'auto', label: t('imageService.cameras.conn.brandAuto') }, ...(brandTemplates as any[]).map((b: any) => ({ value: b.brand, label: b.label }))]} />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.cameras.conn.port')}</label>
                  <input type="number" min={1} max={65535} value={form.rtspPort}
                    onChange={e => { setDetect({ state: 'idle' }); setForm(p => ({ ...p, rtspPort: e.target.value })); }}
                    className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.cameras.conn.channel')}</label>
                  <input type="number" min={1} max={256} value={form.channel}
                    onChange={e => { setDetect({ state: 'idle' }); setForm(p => ({ ...p, channel: e.target.value })); }}
                    className={`w-full px-4 py-2.5 rounded-md ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
                </div>
                <p className={`col-span-2 -mt-2 text-xs ${themeConfig.text.secondary}`}>{t('imageService.cameras.conn.portHint')}</p>
                {form.ipAddress && brandTemplate && (
                  <div className="col-span-2">
                    <p className={`text-xs mb-1 ${themeConfig.text.secondary}`}>{t('imageService.cameras.conn.preview')}</p>
                    <code className={`block text-xs break-all px-3 py-2 rounded-md ${themeConfig.inputBg} ${themeConfig.text.primary}`}>
                      {previewRtspUrl(brandTemplate, form.ipAddress.trim(), form.rtspPort, form.channel, form.username.trim())}
                    </code>
                  </div>
                )}
                <button type="button" className="col-span-2 text-left text-xs text-cyan-400 hover:underline"
                  onClick={() => setForm(p => ({ ...p, connMode: 'manual' }))}>
                  {t('imageService.cameras.conn.manualToggle')}
                </button>
              </>
            ) : (
              <>
            <div className="col-span-2">
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('ui.imageServiceCameras.rtspUrlMain')}{!modal.item && <span className="text-red-400"> *</span>}{cameraStar('rtspUrl')}
              </label>
              <input value={form.rtspUrl} onChange={e => setForm(p => ({ ...p, rtspUrl: e.target.value }))}
                placeholder="rtsp://user:password@192.168.1.64:554/Streaming/Channels/101"
                className={`w-full px-4 py-2.5 rounded-md font-mono text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
              <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>
                {modal.item && isRedactedRtsp(form.rtspUrl) ? t('ui.imageServiceCameras.rtspUrlRedactedHint') : t('ui.imageServiceCameras.rtspUrlHint')}
              </p>
            </div>
            <div className="col-span-2">
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
                {t('ui.imageServiceCameras.rtspUrlSub')}{cameraStar('rtspUrlSub')}
              </label>
              <input value={form.rtspUrlSub} onChange={e => setForm(p => ({ ...p, rtspUrlSub: e.target.value }))}
                placeholder="rtsp://user:password@192.168.1.64:554/Streaming/Channels/102"
                className={`w-full px-4 py-2.5 rounded-md font-mono text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
            </div>
                <button type="button" className="col-span-2 text-left text-xs text-cyan-400 hover:underline"
                  onClick={() => setForm(p => ({ ...p, connMode: 'simple' }))}>
                  {t('imageService.cameras.conn.simpleToggle')}
                </button>
              </>
            )}
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
                {t('ui.imageServiceCameras.streamPath')}{cameraStar('streamPath')}
              </label>
              <input value={form.streamPath} onChange={e => setForm(p => ({ ...p, streamPath: e.target.value }))}
                placeholder="cam/gate1"
                className={`w-full px-4 py-2.5 rounded-md font-mono text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary}`} />
              <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>{t('ui.imageServiceCameras.streamPathHint')}</p>
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
          )}

          <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <Button variant="secondary" type="button" onClick={() => setModal({ open: false })}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={submitting || isNameDuplicate}>{submitting ? t('common.saving') : t('common.save')}</Button>
          </div>
        </form>
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
              <DeletionImpactNote impact={selectedImpact} />
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
                <button onClick={handleDeleteSelectedCameraTrashPermanently} disabled={selectedImpact?.legalHold > 0 || !bulkDeleteTrashPassword || trashBulkDeleting}
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
                  <DeletionImpactNote impact={oneImpact} />
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
                    <button onClick={handlePermanentDeleteCamera} disabled={oneImpact?.legalHold > 0 || !permaDeletePassword || permaDeleting}
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
                  <DeletionImpactNote impact={allTrashImpact} skipsHeld />
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
      {bulkEditOpen && (
        <BulkCameraEditModal
          ids={Array.from(selectedIds)}
          onClose={() => setBulkEditOpen(false)}
          onDone={() => {
            setBulkEditOpen(false);
            setSelectedIds(new Set());
            queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
            queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
            queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
          }}
        />
      )}
    </div>
  );
}
