import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { parseCsv, toCsv } from '@/lib/csv';
import { cameraResolutionText } from '@/components/cctv/CameraSpecCard';

const HEADERS = ['id', 'name', 'recorder', 'channel', 'resolution', 'camera_type', 'camera_brand', 'camera_model'];
const FIELD_LABEL: Record<string, string> = { cameraType: 'camera_type', cameraBrand: 'camera_brand', cameraModel: 'camera_model' };

interface ImportResult {
  dryRun: boolean;
  applied: number;
  counts: { update: number; same: number; error: number };
  results: Array<{ id: string; name: string | null; status: 'update' | 'same' | 'error'; changes: Record<string, { from: string | null; to: string }>; errors: string[] }>;
}

/**
 * Fill in type, brand and model for many cameras: download a sheet with the cameras already listed, fill the last
 * three columns walking the site, upload it, see what would change, then apply. Nothing else on a camera changes.
 */
export function CameraInfoImportModal({ isOpen, onClose, cameras, typeOptions, brandOptions }: {
  isOpen: boolean;
  onClose: () => void;
  cameras: any[];
  typeOptions: Array<{ value: string; label: string }>;
  brandOptions: Array<{ value: string; label: string }>;
}) {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => String(t(`ui.cameraInfoImport.${key}`, opts as any));
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<any[] | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setRows(null); setPreview(null); if (fileRef.current) fileRef.current.value = ''; };
  const close = () => { reset(); onClose(); };

  const downloadTemplate = () => {
    const data = [...cameras]
      .sort((a, b) => String(a.device?.name ?? '').localeCompare(String(b.device?.name ?? ''), 'th') || (a.channelNumber ?? 0) - (b.channelNumber ?? 0))
      .map((c) => ({
        id: c.id, name: c.name, recorder: c.device?.name ?? '', channel: c.channelNumber ?? '',
        resolution: cameraResolutionText(c.spec, ''), camera_type: c.cameraType ?? '', camera_brand: c.cameraBrand ?? '', camera_model: c.cameraModel ?? '',
      }));
    const blob = new Blob(['﻿' + toCsv(HEADERS, data)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'camera-info-sheet.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const send = (items: any[], dryRun: boolean) => imageServiceApi.importCameraInfo(items, dryRun) as Promise<ImportResult>;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length === 0 || !('id' in parsed[0])) {
        toast.error(k('noIdColumn'));
        return;
      }
      const items = parsed.filter((r) => r.id?.trim()).map((r) => ({
        id: r.id.trim(), cameraType: r.camera_type ?? '', cameraBrand: r.camera_brand ?? '', cameraModel: r.camera_model ?? '',
      }));
      setRows(items);
      setPreview(await send(items, true));
    } catch (err: any) {
      if (!err?._handled) toast.error(err?.response?.status === 403 ? k('notYours') : k('failed'));
      reset();
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const done = await send(rows, false);
      toast.success(k('applied', { n: done.applied }));
      await queryClient.invalidateQueries({ queryKey: ['cameras-list'] });
      close();
    } catch (err: any) {
      if (!err?._handled) toast.error(k('failed'));
    } finally {
      setBusy(false);
    }
  };

  const label = (field: string, code: string | null) => {
    if (!code) return '—';
    const opts = field === 'cameraType' ? typeOptions : field === 'cameraBrand' ? brandOptions : null;
    return opts?.find((o) => o.value === code)?.label ?? code;
  };
  const shown = preview?.results.filter((r) => r.status !== 'same') ?? [];

  return (
    <Modal isOpen={isOpen} onClose={close} title={k('title')} size="4xl">
      <div data-camera-info-import className="space-y-4 text-sm text-slate-200">
        <ol className="list-decimal pl-5 space-y-1 text-slate-300">
          <li>{k('step1')}</li>
          <li>{k('step2')}</li>
          <li>{k('step3')}</li>
        </ol>
        <div className="text-xs text-slate-400 space-y-1">
          <p>{k('allowedTypes')}: {typeOptions.map((o) => `${o.value} (${o.label})`).join(', ')}</p>
          <p>{k('allowedBrands')}: {brandOptions.map((o) => `${o.value} (${o.label})`).join(', ')}</p>
          <p>{k('emptyKeeps')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={downloadTemplate} data-info-template>
            <Download size={14} className="mr-1.5" /> {k('download', { n: cameras.length })}
          </Button>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium cursor-pointer">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {k('upload')}
            <input ref={fileRef} data-info-file type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>

        {preview && (
          <div data-info-preview className="space-y-3">
            <p className="flex flex-wrap gap-3 text-xs">
              <span className="text-emerald-300">{k('countUpdate', { n: preview.counts.update })}</span>
              <span className="text-slate-400">{k('countSame', { n: preview.counts.same })}</span>
              {preview.counts.error > 0 && <span className="text-rose-300 font-semibold">{k('countError', { n: preview.counts.error })}</span>}
            </p>
            {preview.counts.error > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-rose-300"><AlertTriangle size={14} />{k('fixFirst')}</p>
            )}
            {shown.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-900 text-slate-500 sticky top-0">
                    <tr><th className="p-2">{k('camera')}</th><th className="p-2">{k('change')}</th></tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={`${r.id}-${i}`} data-info-row={r.status} className="border-t border-slate-800">
                        <td className="p-2 whitespace-nowrap">{r.name ?? r.id}</td>
                        <td className="p-2">
                          {r.status === 'error'
                            ? <span className="text-rose-300">{r.errors.map((e) => k(`error.${e}`)).join(', ')}</span>
                            : Object.entries(r.changes).map(([f, c]) => (
                              <div key={f}><span className="text-slate-500">{FIELD_LABEL[f]}:</span> {label(f, c.from)} → <span className="text-emerald-300">{label(f, c.to)}</span></div>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={reset}>{k('again')}</Button>
              <Button data-info-apply onClick={apply} disabled={busy || preview.counts.error > 0 || preview.counts.update === 0}>
                <CheckCircle2 size={14} className="mr-1.5" /> {k('apply', { n: preview.counts.update })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
