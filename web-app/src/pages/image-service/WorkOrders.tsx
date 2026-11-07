import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, Loader2, Search, Trash2, Upload, Wrench } from 'lucide-react';
import { hasPermission } from '@/App';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { ExportButton, Modal, SearchableSelect, TableSkeleton } from '@/components/ui';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime, toBangkokDateAndTimeString } from '@/utils/dateUtils';

const STATUSES = ['open', 'in_progress', 'completed', 'cancelled'] as const;
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-amber-500/20 text-amber-300',
  completed: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-gray-500/20 text-gray-300',
};

const toInput = (iso?: string | null) => {
  if (!iso) return '';
  const { date, time } = toBangkokDateAndTimeString(new Date(iso));
  return `${date}T${time.slice(0, 5)}`;
};
const fromInput = (value: string) => (value ? new Date(`${value}:00+07:00`).toISOString() : null);

function WorkOrderDialog({ order, canEdit, canSeeCost, onClose }: { order: any; canEdit: boolean; canSeeCost: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    status: order.status as string,
    vendorCompany: order.vendorCompany ?? '',
    technicianName: order.technicianName ?? '',
    contactPhone: order.contactPhone ?? '',
    scheduledAt: toInput(order.scheduledAt),
    parts: order.parts ?? '',
    cost: order.cost ?? '',
    notes: order.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<any[]>(Array.isArray(order.attachments) ? order.attachments : []);
  const w = (key: string, options?: Record<string, unknown>) => String(t(`ui.workOrders.${key}`, options as any));
  const fieldClass = `w-full px-3 py-2 rounded-md text-sm ${themeConfig.inputBg} border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-60`;
  const labelClass = `block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['work-orders'] });
  const failed = (err: any) => {
    if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error'));
  };

  const save = async () => {
    setBusy(true);
    try {
      await imageServiceApi.updateWorkOrder(order.id, {
        status: form.status,
        vendorCompany: form.vendorCompany.trim() || null,
        technicianName: form.technicianName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        scheduledAt: fromInput(form.scheduledAt),
        parts: form.parts.trim() || null,
        ...(canSeeCost ? { cost: form.cost === '' ? null : Number(form.cost) } : {}),
        notes: form.notes.trim() || null,
      });
      toast.success(t('common.saveSuccess'));
      refresh();
      onClose();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const added = await imageServiceApi.uploadWorkOrderAttachment(order.id, file);
      setAttachments((prev) => [...prev, added]);
      refresh();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const open = async (attachment: any) => {
    try {
      const blob = await imageServiceApi.getWorkOrderAttachment(order.id, attachment.filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.originalName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      failed(err);
    }
  };

  const remove = async (attachment: any) => {
    if (!window.confirm(w('removeConfirm', { name: attachment.originalName }))) return;
    try {
      await imageServiceApi.removeWorkOrderAttachment(order.id, attachment.filename);
      setAttachments((prev) => prev.filter((a) => a.filename !== attachment.filename));
      refresh();
    } catch (err) {
      failed(err);
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="3xl" title={w('dialogTitle', { number: order.number })}>
      <div data-work-order-dialog className="space-y-4">
        <div className={`text-sm ${themeConfig.text.secondary}`}>
          <Link to={`/cctv/incidents?incident=${order.incident?.incidentNumber}`} className="text-cyan-400 hover:underline">{order.incident?.incidentNumber}</Link>
          {' · '}{order.incident?.camera?.name}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{w('status')}</label>
            <select data-field="status" disabled={!canEdit} value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} className={`${fieldClass} bg-slate-800`}>
              {STATUSES.map((s) => <option key={s} value={s} className="bg-slate-800 text-slate-100">{w(`status_${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>{w('scheduledAt')}</label>
            <input data-field="scheduledAt" type="datetime-local" disabled={!canEdit} value={form.scheduledAt} onChange={(e) => setForm((p) => ({ ...p, scheduledAt: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>{w('vendorCompany')}</label>
            <input data-field="vendorCompany" disabled={!canEdit} maxLength={200} value={form.vendorCompany} onChange={(e) => setForm((p) => ({ ...p, vendorCompany: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>{w('technicianName')}</label>
            <input data-field="technicianName" disabled={!canEdit} maxLength={200} value={form.technicianName} onChange={(e) => setForm((p) => ({ ...p, technicianName: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>{w('contactPhone')}</label>
            <input data-field="contactPhone" disabled={!canEdit} maxLength={64} value={form.contactPhone} onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))} className={fieldClass} />
          </div>
          {canSeeCost && (
          <div>
            <label className={labelClass}>{w('cost')}</label>
            <input data-field="cost" type="number" min={0} step="0.01" disabled={!canEdit} value={form.cost} onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))} className={fieldClass} />
          </div>
          )}
        </div>
        <div>
          <label className={labelClass}>{w('parts')}</label>
          <textarea data-field="parts" rows={2} disabled={!canEdit} maxLength={4000} value={form.parts} onChange={(e) => setForm((p) => ({ ...p, parts: e.target.value }))} className={`${fieldClass} resize-none`} />
        </div>
        <div>
          <label className={labelClass}>{w('notes')}</label>
          <textarea data-field="notes" rows={2} disabled={!canEdit} maxLength={4000} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={`${fieldClass} resize-none`} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className={labelClass.replace('mb-1.5', '')}>{w('attachments')}</span>
            {canEdit && (
              <>
                <input ref={fileRef} data-field="file" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50">
                  <Upload size={13} /> {w('addFile')}
                </button>
              </>
            )}
          </div>
          {attachments.length === 0 ? (
            <p className={`text-xs ${themeConfig.text.secondary}`}>{w('noFiles')}</p>
          ) : (
            <ul className="space-y-1">
              {attachments.map((a) => (
                <li key={a.filename} data-attachment className="flex items-center gap-2 text-xs">
                  <FileText size={13} className="text-cyan-400 shrink-0" />
                  <button type="button" onClick={() => open(a)} className="text-cyan-300 hover:underline truncate">{a.originalName}</button>
                  <span className={themeConfig.text.secondary}>{Math.max(1, Math.round(a.size / 1024))} KB</span>
                  {canEdit && (
                    <button type="button" title={t('common.delete')} onClick={() => remove(a)} className="ml-auto text-red-400 hover:text-red-300"><Trash2 size={13} /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className={`mt-1 text-[11px] ${themeConfig.text.secondary}`}>{w('fileHint')}</p>
        </div>
        <p className={`text-xs ${themeConfig.text.secondary}`}>{w('completeHint')}</p>
        <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
          <button type="button" onClick={onClose} className={`px-3 py-1.5 rounded-lg text-sm ${themeConfig.text.secondary} hover:bg-white/5`}>{t('common.cancel')}</button>
          {canEdit && (
            <button type="button" data-save-work-order disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50">
              {busy && <Loader2 size={13} className="animate-spin" />}{t('common.save')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Every job handed to an outside technician, whichever incident it came from. */
export default function WorkOrders() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('number') ?? '');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const canEdit = hasPermission(user, 'cameras:update');
  const canSeeCost = hasPermission(user, 'workorders:cost');
  const w = (key: string, options?: Record<string, unknown>) => String(t(`ui.workOrders.${key}`, options as any));

  const { data, isLoading } = useQuery<any>({
    queryKey: ['work-orders', q, status],
    queryFn: () => imageServiceApi.getWorkOrders({ q: q.trim() || undefined, status: status || undefined, limit: 200 }),
    staleTime: 10_000,
  });
  const rows: any[] = data?.data ?? [];
  const opened = rows.find((r) => r.id === openId);

  // Arriving from an incident's work order: straight to it.
  const wanted = params.get('number');
  const arrived = useRef(false);
  useEffect(() => {
    if (!wanted || arrived.current || rows.length === 0) return;
    arrived.current = true;
    const match = rows.find((r) => r.number === wanted);
    if (match) setOpenId(match.id);
  }, [wanted, rows]);

  const money = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const when = (value: string | null) => (value ? formatDateTime(value, i18n.language) : '—');
  const columns = useMemo(() => [
    { key: 'number', label: w('number'), text: (r: any) => r.number },
    { key: 'incident', label: w('incident'), text: (r: any) => r.incident?.incidentNumber ?? '—' },
    { key: 'camera', label: w('camera'), text: (r: any) => r.incident?.camera?.name ?? '—' },
    { key: 'status', label: w('status'), text: (r: any) => w(`status_${r.status}`) },
    { key: 'vendorCompany', label: w('vendorCompany'), text: (r: any) => r.vendorCompany ?? '—' },
    { key: 'technicianName', label: w('technicianName'), text: (r: any) => r.technicianName ?? '—' },
    { key: 'contactPhone', label: w('contactPhone'), text: (r: any) => r.contactPhone ?? '—' },
    { key: 'scheduledAt', label: w('scheduledAt'), text: (r: any) => when(r.scheduledAt) },
    { key: 'completedAt', label: w('completedAt'), text: (r: any) => when(r.completedAt) },
    ...(canSeeCost ? [{ key: 'cost', label: w('cost'), text: (r: any) => money(r.cost) }] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [i18n.language, canSeeCost]);

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <p className={`text-xs font-medium mb-0.5 uppercase tracking-widest ${themeConfig.text.secondary}`}>iSmart CCTV · {w('title')}</p>
          <h2 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{w('title')}</h2>
          <p className={`text-sm ${themeConfig.text.secondary}`}>{w('subtitle')}</p>
        </div>
        <ExportButton
          filename={`work_orders_${new Date().toISOString().slice(0, 10)}`}
          title={w('title')}
          sections={[{ title: w('title'), columns: columns.map((c) => ({ key: c.key, label: c.label })), data: rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, c.text(r)]))) }]}
        />
      </div>

      <div className={`${themeConfig.card} rounded-xl p-4 mb-4 border ${themeConfig.cardBorder}`}>
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input data-work-order-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={w('search')}
              className={`w-full pl-9 pr-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary}`} />
          </div>
          <div className="w-48">
            <SearchableSelect value={status} onChange={setStatus} showSearch={false} placeholder={w('allStatus')}
              options={[{ value: '', label: w('allStatus') }, ...STATUSES.map((s) => ({ value: s, label: w(`status_${s}`) }))]} />
          </div>
        </div>
      </div>

      <div className={`${themeConfig.card} rounded-xl p-4 border ${themeConfig.cardBorder}`}>
        {isLoading ? (
          <TableSkeleton rows={5} cols={8} />
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <Wrench size={36} className="mx-auto text-gray-600 mb-2" />
            <p className={`text-sm ${themeConfig.text.secondary}`}>{w('empty')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-white/5 rounded-lg">
            <table className="w-full text-xs text-left">
              <thead className={themeConfig.tableHeader}>
                <tr>
                  {columns.map((c) => <th key={c.key} className={`px-3 py-3 font-semibold whitespace-nowrap ${themeConfig.text.secondary}`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody className={themeConfig.tableDivide}>
                {rows.map((row) => (
                  <tr key={row.id} data-work-order-row={row.number} onClick={() => setOpenId(row.id)} className={`${themeConfig.tableRow} border-b border-white/5 cursor-pointer hover:bg-white/5`}>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 whitespace-nowrap ${themeConfig.text.primary}`}>
                        {c.key === 'status'
                          ? <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${STATUS_COLORS[row.status] ?? STATUS_COLORS.open}`}>{c.text(row)}</span>
                          : c.text(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {opened && <WorkOrderDialog key={opened.id} order={opened} canEdit={canEdit} canSeeCost={canSeeCost} onClose={() => setOpenId(null)} />}
    </div>
  );
}
