import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import { History, Search, Filter, ChevronLeft, ChevronRight, RotateCcw, Trash2, AlertTriangle, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Modal, Button, SearchableSelect } from '@/components/ui';

const ACTION_LABEL_KEY: Record<string, string> = {
  image_delete: 'imageService.auditLog.actionImageDelete',
  metadata_update: 'imageService.auditLog.actionMetadataUpdate',
  tags_update: 'imageService.auditLog.actionTagsUpdate',
  tag_delete: 'imageService.auditLog.actionTagDelete',
  file_download: 'imageService.auditLog.actionFileDownload',
  policy_create: 'imageService.auditLog.actionPolicyCreate',
  policy_update: 'imageService.auditLog.actionPolicyUpdate',
  policy_delete: 'imageService.auditLog.actionPolicyDelete',
  camera_create: 'imageService.auditLog.actionCameraCreate',
  camera_update: 'imageService.auditLog.actionCameraUpdate',
  camera_delete: 'imageService.auditLog.actionCameraDelete',
  camera_status_change: 'imageService.auditLog.actionCameraStatusChange',
  camera_restore: 'imageService.auditLog.actionCameraRestore',
  camera_permanent_delete: 'imageService.auditLog.actionCameraPermanentDelete',
  camera_trash_empty: 'imageService.auditLog.actionCameraTrashEmpty',
  create: 'imageService.auditLog.actionCreate',
  update: 'imageService.auditLog.actionUpdate',
  delete: 'imageService.auditLog.actionDelete',
  bulk_clear: 'imageService.auditLog.actionBulkClear',
  bulk_delete: 'imageService.auditLog.actionBulkDelete',
  clear_all_data: 'imageService.auditLog.actionClearAllData',
  trash_empty: 'imageService.auditLog.actionTrashEmpty',
  image_bulk_reprocess: 'imageService.auditLog.actionImageBulkReprocess',
  image_reprocess: 'imageService.auditLog.actionImageReprocess',
  image_restore: 'imageService.auditLog.actionImageRestore',
  image_restore_all: 'imageService.auditLog.actionImageRestoreAll',
  incident_workflow_update: 'imageService.auditLog.actionIncidentWorkflowUpdate',
  queue_recover: 'imageService.auditLog.actionQueueRecover',
  required_fields_update: 'imageService.auditLog.actionRequiredFieldsUpdate',
  role_create: 'imageService.auditLog.actionRoleCreate',
  role_update: 'imageService.auditLog.actionRoleUpdate',
  role_delete: 'imageService.auditLog.actionRoleDelete',
  image_lock: 'imageService.auditLog.actionImageLock',
  image_unlock: 'imageService.auditLog.actionImageUnlock',
  manual_cleanup: 'imageService.auditLog.actionManualCleanup',
  emergency_cleanup: 'imageService.auditLog.actionEmergencyCleanup',
};

const BULK_DELETE_DAY_OPTIONS = [7, 14, 30, 60, 90, 120, 240, 365];

const ENTITY_LABEL_KEY: Record<string, string> = {
  image: 'imageService.auditLog.entityImage',
  image_file: 'imageService.auditLog.entityImageFile',
  retention_policy: 'imageService.auditLog.entityRetentionPolicy',
  camera: 'imageService.auditLog.entityCamera',
  alert: 'imageService.auditLog.entityAlert',
  alert_rule: 'imageService.auditLog.entityAlertRule',
  api_key: 'imageService.auditLog.entityApiKey',
  audit_log: 'imageService.auditLog.entityAuditLog',
  camera_template: 'imageService.auditLog.entityCameraTemplate',
  custom_role: 'imageService.auditLog.entityCustomRole',
  incident: 'imageService.auditLog.entityIncident',
  knowledge_article: 'imageService.auditLog.entityKnowledgeArticle',
  masterdata: 'imageService.auditLog.entityMasterdata',
  processing_log: 'imageService.auditLog.entityProcessingLog',
  processing_queue: 'imageService.auditLog.entityProcessingQueue',
  sop_checklist: 'imageService.auditLog.entitySopChecklist',
  storage_profile: 'imageService.auditLog.entityStorageProfile',
  storage_provider: 'imageService.auditLog.entityStorageProvider',
  system: 'imageService.auditLog.entitySystem',
  'system-config': 'imageService.auditLog.entitySystemConfig',
  user: 'imageService.auditLog.entityUser',
};

// Generic fallback for the "Created/Updated/Deleted/Permanently deleted/Cleared
// <details> by <user>" shape used by most newer audit actions (masterdata,
// storage providers/profiles, api keys, camera templates, alert rules, SOP
// checklists, knowledge articles, users, bulk clear/delete, trash-empty, etc).
// Only the leading verb is translated — the rest is left as-is since it holds
// arbitrary entity names/counts that aren't meaningful to translate.
const GENERIC_VERB_KEY: Record<string, string> = {
  'Created': 'imageService.auditLog.verbCreated',
  'Updated': 'imageService.auditLog.verbUpdated',
  'Deleted': 'imageService.auditLog.verbDeleted',
  'Permanently deleted': 'imageService.auditLog.verbPermanentlyDeleted',
  'Cleared': 'imageService.auditLog.verbCleared',
  'Restored': 'imageService.auditLog.verbRestored',
  'Locked': 'imageService.auditLog.verbLocked',
  'Unlocked': 'imageService.auditLog.verbUnlocked',
};

const localizeDescription = (description: string, action: string, t: any) => {
  if (!description) return '—';

  // 1. camera status change
  // Format: Camera "Name" status changed: active → maintenance by admin
  if (action === 'camera_status_change') {
    const match = description.match(/Camera "([^"]+)" status changed: ([^\s]+) → ([^\s]+) by ([^\s]+)/i);
    if (match) {
      const [, name, from, to, user] = match;
      const statusLabels: Record<string, string> = {
        active: t('imageService.cameras.statusActive', 'Online'),
        maintenance: t('imageService.cameras.statusMaintenance', 'Maintenance'),
        inactive: t('imageService.cameras.statusInactive', 'Offline'),
        error: t('imageService.cameras.statusError', 'Error'),
      };
      return t('imageService.auditLog.descCameraStatusChanged', {
        name,
        from: statusLabels[from] || from,
        to: statusLabels[to] || to,
        user
      });
    }
  }

  // 2. camera update
  // Format: Camera "Name" updated by admin
  if (action === 'camera_update') {
    const match = description.match(/Camera "([^"]+)" updated by ([^\s]+)/i);
    if (match) {
      const [, name, user] = match;
      return t('imageService.auditLog.descCameraUpdated', { name, user });
    }
  }

  // 3. camera create
  // Format: Camera "Name" created by admin
  if (action === 'camera_create') {
    const match = description.match(/Camera "([^"]+)" created by ([^\s]+)/i);
    if (match) {
      const [, name, user] = match;
      return t('imageService.auditLog.descCameraCreated', { name, user });
    }
  }

  // 4. camera delete
  // Format: Camera "Name" deleted (deactivated) by admin
  if (action === 'camera_delete') {
    const match = description.match(/Camera "([^"]+)" deleted \(deactivated\) by ([^\s]+)/i);
    if (match) {
      const [, name, user] = match;
      return t('imageService.auditLog.descCameraDeleted', { name, user });
    }
  }

  // 5. camera restore
  // Format: Camera "Name" restored from trash by admin
  if (action === 'camera_restore') {
    const match = description.match(/Camera "([^"]+)" restored from trash by ([^\s]+)/i);
    if (match) {
      const [, name, user] = match;
      return t('imageService.auditLog.descCameraRestored', { name, user });
    }
  }

  // 6. camera permanent delete
  // Format: Camera "Name" permanently deleted by admin
  if (action === 'camera_permanent_delete') {
    const match = description.match(/Camera "([^"]+)" permanently deleted by ([^\s]+)/i);
    if (match) {
      const [, name, user] = match;
      return t('imageService.auditLog.descCameraPermanentDeleted', { name, user });
    }
  }

  // 7. Generic fallback: "<Verb> <details> by <user>"
  const generic = description.match(/^(Created|Updated|Deleted|Permanently deleted|Cleared|Restored|Locked|Unlocked)\s+(.+?)\s+by\s+(\S+)$/);
  if (generic) {
    const [, verb, rest, user] = generic;
    const verbKey = GENERIC_VERB_KEY[verb];
    if (verbKey) {
      const translatedVerb = t(verbKey);
      if (translatedVerb !== verbKey) {
        return t('imageService.auditLog.descGeneric', { verb: translatedVerb, rest, user });
      }
    }
  }

  return description;
};

export default function AuditLogViewer() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [sortCol, setSortCol] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(1);
  };

  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeletePassword, setBulkDeletePassword] = useState('');
  const [bulkDeleteDays, setBulkDeleteDays] = useState(30);
  const [bulkDeleteLoadingPreview, setBulkDeleteLoadingPreview] = useState(false);
  const [bulkDeletePreview, setBulkDeletePreview] = useState<any>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchBulkDeletePreview = useCallback(async (days: number) => {
    setBulkDeleteLoadingPreview(true);
    try {
      const res = await imageServiceApi.bulkDeleteAuditPreview(days);
      setBulkDeletePreview(res);
    } catch {
      setBulkDeletePreview(null);
    } finally {
      setBulkDeleteLoadingPreview(false);
    }
  }, []);

  const handleOpenBulkDelete = useCallback(() => {
    setBulkDeleteOpen(true);
    setBulkDeletePassword('');
    setBulkDeletePreview(null);
    setBulkDeleteDays(30);
    fetchBulkDeletePreview(30);
  }, [fetchBulkDeletePreview]);

  const handleBulkDeleteDaysChange = useCallback((days: number) => {
    setBulkDeleteDays(days);
    fetchBulkDeletePreview(days);
  }, [fetchBulkDeletePreview]);

  const handleBulkDelete = useCallback(async () => {
    if (!bulkDeletePassword || !bulkDeletePreview) return;
    setBulkDeleting(true);
    try {
      const result = await imageServiceApi.bulkDeleteAuditByAge(bulkDeleteDays, bulkDeletePassword);
      toast.success(t('imageService.auditLog.bulkDeleteSuccess', { count: result.deleted }));
      setBulkDeleteOpen(false);
      setBulkDeletePassword('');
      setBulkDeletePreview(null);
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    } catch (e: any) {
      if (e?.response?.status === 401) {
        toast.error(t('imageService.auditLog.bulkDeleteWrongPassword'));
      } else if (!e?._handled) {
        toast.error(t('common.error'));
      }
    } finally {
      setBulkDeleting(false);
    }
  }, [bulkDeleteDays, bulkDeletePassword, bulkDeletePreview, t, toast, queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, limit, action, entity, sortCol, sortDir],
    queryFn: () => imageServiceApi.getAuditLogs({
      page, limit, action: action || undefined, entity: entity || undefined,
      sortBy: sortCol, sortDir,
    }),
    staleTime: 1000 * 30,
  });

  const logs = data?.data ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: 50, total: 0, totalPages: 0 };

  const tableHeaderClass = `text-xs font-medium uppercase tracking-wider ${themeConfig.text.secondary} px-4 py-3 text-left`;
  const tableCellClass = `text-sm px-4 py-2.5 ${themeConfig.text.primary}`;

  return (
    <div className="pt-6 px-6 pb-2.5">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          iSmart CCTV · {t('imageService.auditLog.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.auditLog.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.auditLog.subtitle')}</p>
      </div>

      <div className={`${themeConfig.card} rounded-lg p-4 mb-5 flex items-center gap-3`}>
        <Filter size={15} className={themeConfig.text.secondary} />
        <div className="w-44">
          <SearchableSelect value={action} onChange={v => { setAction(v); setPage(1) }}
            options={[
              { value: '', label: t('imageService.auditLog.allActions') },
              ...Object.keys(ACTION_LABEL_KEY).map(a => ({ value: a, label: t(ACTION_LABEL_KEY[a]) })),
            ]} />
        </div>
        <div className="w-40">
          <SearchableSelect value={entity} onChange={v => { setEntity(v); setPage(1) }}
            options={[
              { value: '', label: t('imageService.auditLog.allEntities') },
              ...Object.keys(ENTITY_LABEL_KEY).map(e => ({ value: e, label: t(ENTITY_LABEL_KEY[e]) })),
            ]} />
        </div>
        {hasPermission(user, 'audit-log:delete') && (
          <button onClick={handleOpenBulkDelete}
            className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={13} /> {t('imageService.auditLog.bulkDelete')}
          </button>
        )}
        <span className={`text-xs ${themeConfig.text.secondary} ml-auto`}>
          {pagination.total} {t('common.records')}
        </span>
      </div>

      <div className={`${themeConfig.card} rounded-lg overflow-hidden flex flex-col mb-2`}>
        <div className="overflow-x-auto overflow-y-auto relative" style={{ height: 'calc(100vh - 353px)', maxHeight: 'calc(100vh - 353px)' }}>
          <table className="w-full">
            <thead className={`${themeConfig.tableHeader} sticky top-0 z-10 shadow-sm`}>
              <tr className={`border-b ${themeConfig.cardBorder}`}>
                {[
                  { key: 'createdAt', label: t('imageService.auditLog.time') },
                  { key: 'username', label: t('imageService.auditLog.user') },
                  { key: 'action', label: t('imageService.auditLog.action') },
                  { key: 'entity', label: t('imageService.auditLog.entity') },
                  { key: 'entityId', label: t('imageService.auditLog.entityId') },
                  { key: 'description', label: t('imageService.auditLog.description') },
                  { key: 'ipAddress', label: t('imageService.auditLog.ip') },
                ].map(col => (
                  <th key={col.key} onClick={() => handleSort(col.key)}
                    className={`${tableHeaderClass} cursor-pointer select-none hover:text-cyan-300`}>
                    <div className="flex items-center gap-1">
                      {col.label}
                      {sortCol === col.key
                        ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" />
                        : <ChevronsUpDown size={11} className="opacity-25" />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                <tr><td colSpan={7} className={`text-center py-8 text-sm ${themeConfig.text.secondary}`}>{t('common.loading')}</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} className={`text-center py-8 text-sm ${themeConfig.text.secondary}`}>
                  {t('imageService.auditLog.noLogs')}
                </td></tr>
              ) : logs.map((log: any) => (
                <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className={`${tableCellClass} text-xs whitespace-nowrap`}>
                    {formatDateTime(log.createdAt, i18n.language)}
                  </td>
                  <td className={tableCellClass}>
                    <span className="text-xs font-medium">{log.username || log.userId?.slice(0, 8) || t('common.system')}</span>
                  </td>
                  <td className={tableCellClass}>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      log.action.includes('delete') ? 'bg-red-500/10 text-red-400' :
                      log.action.includes('create') ? 'bg-green-500/10 text-green-400' :
                      'bg-blue-500/10 text-blue-400'
                    }`}>
                      {t(ACTION_LABEL_KEY[log.action] ?? log.action.replace(/_/g, ' '))}
                    </span>
                  </td>
                  <td className={`${tableCellClass} text-xs text-gray-400`}>{t(ENTITY_LABEL_KEY[log.entity] ?? log.entity)}</td>
                  <td className={`${tableCellClass} text-xs text-gray-400 font-mono max-w-[120px] truncate`}>
                    {log.entityId || '—'}
                  </td>
                  <td className={`${tableCellClass} text-xs text-gray-400 max-w-[200px] truncate`} title={localizeDescription(log.description, log.action, t)}>
                    {localizeDescription(log.description, log.action, t)}
                  </td>
                  <td className={`${tableCellClass} text-xs text-gray-500 font-mono`}>{log.ipAddress || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className={`flex flex-wrap items-center justify-between gap-4 p-4 border-t ${themeConfig.cardBorder} bg-white/[0.01]`}>
          <div className="flex items-center gap-2">
            <span className={`text-xs ${themeConfig.text.secondary}`}>{t('common.showPerPage', 'แสดงต่อหน้า')}:</span>
            <div className="w-20">
              <SearchableSelect
                value={String(limit)}
                onChange={(v) => {
                  setLimit(Number(v))
                  setPage(1)
                }}
                showSearch={false}
                options={[10, 20, 50, 100].map(v => ({
                  value: String(v),
                  label: String(v)
                }))}
              />
            </div>
            <span className={`text-xs ${themeConfig.text.secondary} ml-2`}>
              {t('imageService.auditLog.totalLogs', 'ทั้งหมด {{count}} รายการ', { count: pagination.total })}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              disabled={page <= 1}
              onClick={() => setPage(1)}
              className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
            >
              « {t('common.first', 'หน้าแรก')}
            </button>
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
            >
              ‹ {t('common.prev', 'ก่อนหน้า')}
            </button>
            
            <div className="flex items-center gap-1 mx-1">
              <input
                type="number"
                value={page}
                min={1}
                max={pagination.totalPages || 1}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  if (val >= 1 && val <= (pagination.totalPages || 1)) setPage(val)
                }}
                className={`w-10 px-1 py-1 rounded text-xs text-center border ${themeConfig.inputBorder} ${themeConfig.card} ${themeConfig.text.primary} focus:outline-none focus:border-cyan-500 bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
              />
              <span className={`text-xs ${themeConfig.text.secondary}`}>/ {pagination.totalPages || 1}</span>
            </div>

            <button
              disabled={page >= (pagination.totalPages || 1)}
              onClick={() => setPage(p => p + 1)}
              className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
            >
              {t('common.next', 'ถัดไป')} ›
            </button>
            <button
              disabled={page >= (pagination.totalPages || 1)}
              onClick={() => setPage(pagination.totalPages || 1)}
              className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
            >
              {t('common.last', 'หน้าสุดท้าย')} »
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Delete Modal */}
      <Modal isOpen={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} title={t('imageService.auditLog.bulkDeleteTitle')}>
        <div className="space-y-5 p-1 max-w-md">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className={`text-xs ${themeConfig.text.secondary}`}>
              {t('imageService.auditLog.bulkDeleteWarning')}
            </p>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
              {t('imageService.auditLog.bulkDeleteDays')}
            </label>
            <SearchableSelect
              value={String(bulkDeleteDays)}
              onChange={v => handleBulkDeleteDaysChange(Number(v))}
              placeholder={t('imageService.auditLog.bulkDeleteDays')}
              options={BULK_DELETE_DAY_OPTIONS.map(d => ({ value: String(d), label: `${d} ${t('imageService.auditLog.days')}` }))}
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
                {t('imageService.auditLog.bulkDeletePreview', {
                  count: bulkDeletePreview.count,
                  date: bulkDeletePreview.cutoffDate.split('T')[0],
                })}
              </p>
            ) : null}
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>
              {t('imageService.auditLog.bulkDeleteConfirm')}
            </label>
            <input
              type="password" autoComplete="new-password"
              value={bulkDeletePassword}
              onChange={e => setBulkDeletePassword(e.target.value)}
              placeholder={t('imageService.auditLog.bulkDeletePassword')}
              className={`w-full px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-red-500/50`}
              onKeyDown={e => { if (e.key === 'Enter' && bulkDeletePassword && bulkDeletePreview && bulkDeletePreview.count > 0) handleBulkDelete(); }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
            <Button variant="secondary" onClick={() => setBulkDeleteOpen(false)}>
              {t('common.close')}
            </Button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting || !bulkDeletePassword || !bulkDeletePreview || bulkDeletePreview.count === 0}
              className="px-4 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
            >
              {bulkDeleting ? (
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Trash2 size={14} />
              )}
              {t('imageService.auditLog.bulkDelete')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
