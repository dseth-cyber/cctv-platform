import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import {
  Plus, Trash2, Key, Copy, CheckCircle, XCircle, ExternalLink, Info,
} from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { ColumnSelector } from '@/components/ui/ColumnSelector';
import { TableSkeleton } from '@/components/ui/TableSkeleton';

type SortDir = 'asc' | 'desc';

const PERMISSION_OPTIONS = [
  { key: 'overview:read', label: 'Overview' },
  { key: 'cameras:read', label: 'Cameras (read)' },
  { key: 'search:read', label: 'Images (read)' },
  { key: 'search:update', label: 'Images (update)' },
  { key: 'processing:read', label: 'Processing (read)' },
  { key: 'storage:read', label: 'Storage (read)' },
  { key: 'alerts:read', label: 'Alerts (read)' },
  { key: 'health:read', label: 'Health (read)' },
  { key: '*', label: 'Full Access (*)' },
];

export default function ApiKeysManagement() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; editing?: any }>({ open: false });
  const [form, setForm] = useState({ name: '', permissions: ['*'] as string[], expiresAt: '' });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sortKey, setSortKey] = useState<string>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys', page],
    queryFn: () => imageServiceApi.getApiKeys({ page, limit: 20 }),
    staleTime: 1000 * 30,
  });

  const keysArr = (data as any)?.data ?? [];
  const pagination = (data as any)?.pagination;

  const createMutation = useMutation({
    mutationFn: (d: any) => imageServiceApi.createApiKey(d),
    onSuccess: (res: any) => {
      setCreatedKey(res.token);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key created');
    },
    onError: () => toast.error(t('common.error')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteApiKey(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['api-keys'] }); toast.success('API key deleted'); },
    onError: () => toast.error(t('common.error')),
  });

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const fmtDate = (d: string) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString(i18n.language === 'th' ? 'th-TH' : i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return d; }
  };

  const sorted = [...keysArr].sort((a: any, b: any) => {
    const av = a[sortKey]; const bv = b[sortKey];
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? (av ?? '') > (bv ?? '') ? 1 : -1 : (av ?? '') > (bv ?? '') ? -1 : 1;
  });

  const handlePermissionToggle = (key: string, checked: boolean) => {
    if (key === '*') {
      // If Full Access is toggled on, set permissions to just ['*']
      // If toggled off, clear all
      setForm(f => ({ ...f, permissions: checked ? ['*'] : [] }));
    } else {
      setForm(f => {
        let next = checked
          ? [...f.permissions.filter(p => p !== '*'), key]
          : f.permissions.filter(p => p !== key);
        // Remove duplicates
        next = [...new Set(next)];
        return { ...f, permissions: next };
      });
    }
  };

  const handleCreate = () => {
    createMutation.mutate({
      name: form.name,
      permissions: form.permissions,
      expiresAt: form.expiresAt || undefined,
    });
  };

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const SortIcon = ({ k }: { k: string }) => {
    if (sortKey !== k) return null;
    return <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  const thClass = `px-4 py-3 text-left text-sm font-semibold cursor-pointer select-none ${themeConfig.text.primary}`;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
            Image Service · {t('imageService.apiKeys.title')}
          </p>
          <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.apiKeys.title')}</h1>
          <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('imageService.apiKeys.subtitle')}</p>
        </div>
        <Button onClick={() => { setForm({ name: '', permissions: ['*'], expiresAt: '' }); setCreatedKey(null); setModal({ open: true }); }}>
          <Plus size={16} className="mr-1.5" /> {t('imageService.apiKeys.createKey')}
        </Button>
      </div>

      <div className={`${themeConfig.card} rounded-lg overflow-hidden`}>
        {isLoading ? <TableSkeleton rows={5} cols={5} /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className={themeConfig.tableHeader}>
                <tr>
                  <th className={thClass} onClick={() => toggleSort('name')}>{t('imageService.apiKeys.name')}<SortIcon k="name" /></th>
                  <th className={thClass} onClick={() => toggleSort('tokenPrefix')}>{t('imageService.apiKeys.key')}<SortIcon k="tokenPrefix" /></th>
                  <th className={thClass} onClick={() => toggleSort('enabled')}>{t('imageService.apiKeys.status')}<SortIcon k="enabled" /></th>
                  <th className={thClass} onClick={() => toggleSort('permissions')}>{t('imageService.apiKeys.permissions')}<SortIcon k="permissions" /></th>
                  <th className={thClass} onClick={() => toggleSort('createdBy')}>{t('imageService.apiKeys.createdBy')}<SortIcon k="createdBy" /></th>
                  <th className={thClass} onClick={() => toggleSort('createdAt')}>{t('imageService.apiKeys.createdAt')}<SortIcon k="createdAt" /></th>
                  <th className={thClass} onClick={() => toggleSort('expiresAt')}>{t('imageService.apiKeys.expiresAt')}<SortIcon k="expiresAt" /></th>
                  <th className={`px-4 py-3 text-center text-sm font-semibold ${themeConfig.text.primary}`}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={8} className={`px-4 py-8 text-center text-sm ${themeConfig.text.secondary}`}>{t('common.noData')}</td></tr>
                ) : sorted.map((keyItem: any) => (
                  <tr key={keyItem.id} className={`border-t ${themeConfig.tableBorder} hover:bg-white/5 transition-colors`}>
                    <td className={`px-4 py-3 text-sm font-medium ${themeConfig.text.primary}`}>{keyItem.name}</td>
                    <td className={`px-4 py-3 text-sm font-mono ${themeConfig.text.secondary}`}>
                      <div className="flex items-center gap-1">
                        <Key size={13} className="text-cyan-400" />
                        {keyItem.tokenPrefix}...
                        <button onClick={() => handleCopy(keyItem.tokenPrefix)} className="ml-1 text-gray-400 hover:text-cyan-400">
                          <Copy size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {keyItem.enabled ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">
                          <CheckCircle size={11} /> {t('imageService.apiKeys.active')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-400">
                          <XCircle size={11} /> {t('imageService.apiKeys.inactive')}
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-sm font-mono ${themeConfig.text.secondary}`}>
                      {(keyItem.permissions ?? []).join(', ')}
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {keyItem.createdBy || '—'}
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {fmtDate(keyItem.createdAt)}
                    </td>
                    <td className={`px-4 py-3 text-sm ${themeConfig.text.secondary}`}>
                      {keyItem.expiresAt ? fmtDate(keyItem.expiresAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => deleteMutation.mutate(keyItem.id)}
                        className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pagination && pagination.total > 0 && (
          <div className={`flex items-center justify-between px-4 py-3 border-t ${themeConfig.tableBorder}`}>
            <span className={`text-xs ${themeConfig.text.secondary}`}>
              {t('imageService.apiKeys.total', { count: pagination.total })}
            </span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className={`px-3 py-1.5 text-xs rounded-md border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                {t('common.prev')}
              </button>
              <span className={`text-xs ${themeConfig.text.secondary}`}>{page} / {pagination.totalPages}</span>
              <button disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}
                className={`px-3 py-1.5 text-xs rounded-md border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30`}>
                {t('common.next')}
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={modal.open} onClose={() => { setModal({ open: false }); setCreatedKey(null); }}
        title={createdKey ? 'API Key Created' : t('imageService.apiKeys.createKey')}>
        {createdKey ? (
          <div className="space-y-4">
            <div className="px-4 py-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <p className="text-sm text-cyan-400 font-medium mb-1">Your API Key</p>
              <p className="text-xs text-cyan-300/70 mb-2">Copy this key now. You won't be able to see it again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded bg-black/30 text-sm font-mono text-cyan-300 break-all select-all">
                  {createdKey}
                </code>
                <Button variant="secondary" onClick={() => handleCopy(createdKey)} size="sm">
                  {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                </Button>
              </div>
            </div>
            <div className={`px-4 py-3 rounded-lg ${themeConfig.card}`}>
              <h4 className={`text-sm font-semibold mb-2 ${themeConfig.text.primary}`}>Connection Details</h4>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className={themeConfig.text.secondary}>Auth Header:</span>
                  <span className="font-mono text-cyan-400">x-api-token</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={themeConfig.text.secondary}>Base URL:</span>
                  <span className="font-mono text-cyan-400">{window.location.origin}/image-service/api/v1</span>
                </div>
                <p className={`mt-2 italic ${themeConfig.text.secondary}`}>
                  * เปลี่ยน localhost เป็น IP เครื่อง (เช่น 192.168.1.x) เพื่อให้เครื่องอื่นเข้าถึงได้
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => { setModal({ open: false }); setCreatedKey(null); }}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.apiKeys.name')}</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className={`w-full px-4 py-2.5 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.apiKeys.permissions')}</label>
              <div className="grid grid-cols-2 gap-2 p-3 rounded-lg border border-white/10 bg-black/20">
                {PERMISSION_OPTIONS.map(opt => {
                  const isFullAccess = form.permissions.includes('*');
                  const isChecked = opt.key === '*' ? isFullAccess : (isFullAccess || form.permissions.includes(opt.key));
                  const isDisabled = opt.key !== '*' && isFullAccess;
                  return (
                    <label key={opt.key} className={`flex items-center gap-2.5 p-1.5 rounded hover:bg-white/5 cursor-pointer text-xs ${isDisabled ? 'opacity-60' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isDisabled}
                        onChange={e => handlePermissionToggle(opt.key, e.target.checked)}
                        className="rounded border-white/30 bg-white/10 text-cyan-500 focus:ring-cyan-500/50"
                      />
                      <span className={`${themeConfig.text.primary} ${opt.key === '*' ? 'font-semibold text-cyan-400' : ''}`}>
                        {opt.label}
                      </span>
                    </label>
                  );
                })}
              </div>
              {form.permissions.length === 0 && (
                <p className="text-xs mt-1 text-red-400">{t('imageService.apiKeys.selectPermission')}</p>
              )}
            </div>
            <div>
              <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.apiKeys.expiresAt')}</label>
              <input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                className={`w-full px-4 py-2.5 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
              <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>Leave empty for no expiration</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setModal({ open: false })}>{t('common.cancel')}</Button>
              <Button onClick={handleCreate} disabled={!form.name || form.permissions.length === 0 || createMutation.isPending}>
                {createMutation.isPending ? t('common.saving') : t('imageService.apiKeys.generate')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
