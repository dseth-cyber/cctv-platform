import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bookmark, Save, Share2, Trash2, Users, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';

export type WallLayout = '1x1' | '2x2' | '3x3' | '4x4';
export interface LiveViewSlot { slotIndex: number; cameraId: string }
export interface LiveView {
  id: string;
  name: string;
  layout: WallLayout;
  shared: boolean;
  slots: LiveViewSlot[];
  hiddenSlots: number;
  owner: { id: string; username: string };
  mine: boolean;
  canEdit: boolean;
}

const QUERY_KEY = ['live-views'];
/** Where views lived before they moved to the server. */
const OLD_STORAGE_KEY = 'cctv_live_presets';
/** Once per page load, however many components use the hook, so no view is moved twice. */
let moveStarted = false;

/**
 * Saved live walls from the server: one's own and the team's. On first use, views kept in this browser before are
 * moved up as private views; a view that cannot be moved (a camera since deleted, say) stays in the browser.
 */
export function useLiveViews() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const query = useQuery<LiveView[]>({ queryKey: QUERY_KEY, queryFn: imageServiceApi.getLiveViews, staleTime: 30_000 });

  useEffect(() => {
    if (moveStarted) return;
    let old: any[] = [];
    try { old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) ?? '[]'); } catch { old = []; }
    if (!Array.isArray(old) || old.length === 0) return;
    moveStarted = true;
    (async () => {
      const left: any[] = [];
      let moved = 0;
      for (const p of old) {
        try {
          await imageServiceApi.createLiveView({
            name: String(p.name ?? '').slice(0, 60) || 'View',
            layout: p.layout,
            slots: (p.slots ?? []).map((s: any) => ({ slotIndex: s.slotIndex, cameraId: s.cameraId })),
            shared: false,
          });
          moved += 1;
        } catch {
          left.push(p);
        }
      }
      try {
        if (left.length) localStorage.setItem(OLD_STORAGE_KEY, JSON.stringify(left));
        else localStorage.removeItem(OLD_STORAGE_KEY);
      } catch { /* storage blocked: nothing more to do */ }
      if (moved) {
        toast.success(t('ui.liveViews.migrated', { n: moved }));
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      }
    })();
  }, [queryClient, toast, t]);

  return query;
}

export function LiveViewsModal({ open, onClose, layout, currentSlots, canShare, onLoad }: {
  open: boolean;
  onClose: () => void;
  layout: WallLayout;
  currentSlots: LiveViewSlot[];
  canShare: boolean;
  onLoad: (view: LiveView) => void;
}) {
  const { t } = useTranslation();
  const k = (key: string, opts?: Record<string, unknown>) => String(t(`ui.liveViews.${key}`, opts as any));
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: views = [] } = useLiveViews();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const fail = (err: any) => {
    if (err?._handled) return;
    toast.error(err?.response?.status === 403 ? k('noRight') : (err?.response?.data?.message ?? k('failed')));
  };

  const save = async () => {
    if (!name.trim() || currentSlots.length === 0) return;
    setBusy(true);
    try {
      await imageServiceApi.createLiveView({ name: name.trim(), layout, slots: currentSlots, shared: canShare && shared });
      toast.success(k('saved'));
      setName('');
      setShared(false);
      await refresh();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const toggleShare = async (v: LiveView, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await imageServiceApi.updateLiveView(v.id, { shared: !v.shared });
      await refresh();
    } catch (err) { fail(err); }
  };

  const remove = async (v: LiveView, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(k(v.shared ? 'deleteSharedConfirm' : 'deleteConfirm', { name: v.name }))) return;
    try {
      await imageServiceApi.deleteLiveView(v.id);
      await refresh();
    } catch (err) { fail(err); }
  };

  const mine = views.filter((v) => v.mine);
  const team = views.filter((v) => !v.mine);
  const row = (v: LiveView) => (
    <div
      key={v.id}
      data-live-view={v.id}
      onClick={() => { onLoad(v); onClose(); }}
      className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800/80 cursor-pointer transition flex items-center justify-between gap-2"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-200 truncate">{v.name}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 border border-slate-700">{v.layout}</span>
          {v.shared && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
              <Users className="w-3 h-3" />{k('teamBadge')}
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-500">
          {k('cameras', { n: v.slots.length })}
          {!v.mine && <> · {k('by', { name: v.owner.username })}</>}
        </span>
        {v.hiddenSlots > 0 && <p className="text-[10px] text-amber-300/80">{k('hidden', { n: v.hiddenSlots })}</p>}
      </div>
      {v.canEdit && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {canShare && (
            <button
              type="button"
              data-live-view-share
              onClick={(e) => toggleShare(v, e)}
              className={`p-1 transition ${v.shared ? 'text-emerald-400 hover:text-slate-300' : 'text-slate-500 hover:text-emerald-400'}`}
              title={k(v.shared ? 'unshare' : 'share')}
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button type="button" data-live-view-delete onClick={(e) => remove(v, e)} className="p-1 text-slate-500 hover:text-rose-400 transition" title={k('delete')}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div data-live-views className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100">{k('title')}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>

        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 space-y-2">
          <span className="text-xs font-semibold text-slate-300">{k('saveCurrent', { layout, n: currentSlots.length })}</span>
          <div className="flex gap-2">
            <input
              type="text"
              data-live-view-name
              maxLength={60}
              placeholder={k('namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="button"
              data-live-view-save
              onClick={save}
              disabled={busy || !name.trim() || currentSlots.length === 0}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg flex items-center gap-1 transition"
            >
              <Save className="w-3.5 h-3.5" /><span>{t('common.save')}</span>
            </button>
          </div>
          {currentSlots.length === 0 && <p data-live-view-empty-wall className="text-[10px] text-amber-300/80">{k('emptyWall')}</p>}
          {canShare && (
            <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" data-live-view-shared checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 accent-emerald-500" />
              <span>{k('shareWithTeam')}<span className="block text-[10px] text-slate-500">{k('shareHint')}</span></span>
            </label>
          )}
        </div>

        <div className="space-y-3 max-h-72 overflow-auto">
          {views.length === 0 && <p className="text-xs text-slate-600 text-center py-4">{k('empty')}</p>}
          {mine.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-400">{k('mine')}</span>
              {mine.map(row)}
            </div>
          )}
          {team.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-400">{k('team')}</span>
              {team.map(row)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
