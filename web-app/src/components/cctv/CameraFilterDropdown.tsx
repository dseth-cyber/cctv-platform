import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Filter, FolderTree, HardDrive, Search, X } from 'lucide-react';
import { cameraSearchText, groupCamerasByDevice, groupsOfCameras, matchesCameraQuery } from '@/lib/cameraFilter';

interface Props {
  cameras: any[];
  selectedIds: string[];
  onlyOffline: boolean;
  onApply: (selectedIds: string[], onlyOffline: boolean) => void;
}

/**
 * Search + checkboxes over every camera, grouped by DVR/NVR. Changes are drafted while the panel is
 * open and applied once on close: each applied change restarts the streams on screen, so ticking ten
 * boxes must not restart them ten times. Escape discards the draft.
 */
export function CameraFilterDropdown({ cameras, selectedIds, onlyOffline, onApply }: Props) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [draftOffline, setDraftOffline] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const onlineLabel = t('ui.liveGrid.online');
  const offlineLabel = t('ui.liveGrid.offline');
  const indexed = useMemo(
    () => cameras.map((cam) => ({ cam, text: cameraSearchText(cam, cam.operationalStatus === 'online' ? onlineLabel : offlineLabel) })),
    [cameras, onlineLabel, offlineLabel],
  );
  const matched = useMemo(
    () =>
      indexed
        .filter(({ cam, text }) => matchesCameraQuery(text, query) && (!draftOffline || cam.operationalStatus !== 'online'))
        .map(({ cam }) => cam),
    [indexed, query, draftOffline],
  );
  const groups = useMemo(() => groupCamerasByDevice(matched), [matched]);
  const namedGroups = useMemo(() => groupsOfCameras(matched), [matched]);

  const close = (apply: boolean) => {
    setOpen(false);
    if (!apply) return;
    const next = [...draft];
    const unchanged = draftOffline === onlyOffline && next.length === selectedIds.length && next.every((id) => selectedIds.includes(id));
    if (!unchanged) onApply(next, draftOffline);
  };

  // The listeners stay bound while the panel is open and read the latest draft through this ref.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeRef.current(true);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggleOpen = () => {
    if (open) return close(true);
    setDraft(new Set(selectedIds));
    setDraftOffline(onlyOffline);
    setQuery('');
    setExpanded(new Set());
    setOpen(true);
  };

  const setMany = (ids: string[], checked: boolean) => {
    setDraft((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const summary =
    selectedIds.length > 0
      ? t('ui.liveGrid.filter.selected', { count: selectedIds.length })
      : t('ui.liveGrid.filter.all');
  const matchedIds = matched.map((c) => c.id);
  const isSearching = query.trim().length > 0;

  const row = (cam: any) => (
    <label key={cam.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-800 cursor-pointer text-xs">
      <input
        type="checkbox"
        checked={draft.has(cam.id)}
        onChange={(e) => setMany([cam.id], e.target.checked)}
        className="w-3.5 h-3.5 accent-cyan-500 shrink-0"
      />
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cam.operationalStatus === 'online' ? 'bg-emerald-400' : 'bg-rose-500'}`} />
      <span className="text-slate-200 truncate flex-1" title={cam.name}>{cam.name}</span>
      {cam.ipAddress && <span className="text-[10px] font-mono text-slate-500 shrink-0">{cam.ipAddress}</span>}
    </label>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        data-camera-filter-button
        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm border backdrop-blur-md transition ${
          selectedIds.length > 0 || onlyOffline
            ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-100'
            : 'bg-white/10 border-white/30 text-gray-400'
        }`}
      >
        <Filter size={14} className="text-gray-400 shrink-0" />
        <span className="whitespace-nowrap">{summary}</span>
        {onlyOffline && <span className="text-rose-300 whitespace-nowrap">· {t('ui.liveGrid.filter.onlyOffline')}</span>}
        <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-[26rem] max-w-[calc(100vw-2rem)] z-50 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl flex flex-col max-h-[70vh] select-text">
          <div className="p-2 border-b border-slate-800 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('ui.liveGrid.filter.searchPlaceholder')}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-8 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={matchedIds.length > 0 && matchedIds.every((id) => draft.has(id))}
                  onChange={(e) => setMany(matchedIds, e.target.checked)}
                  className="w-3.5 h-3.5 accent-cyan-500"
                />
                {t('ui.liveGrid.filter.selectAllMatched', { count: matchedIds.length })}
              </label>
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftOffline}
                  onChange={(e) => setDraftOffline(e.target.checked)}
                  className="w-3.5 h-3.5 accent-rose-500"
                />
                {t('ui.liveGrid.filter.onlyOffline')}
              </label>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 min-h-[6rem]">
            {matched.length === 0 && <p className="p-4 text-center text-xs text-slate-500">{t('ui.liveGrid.filter.noMatch')}</p>}
            {namedGroups.length > 0 && (
              <div className="pb-1 mb-1 border-b border-slate-800">
                <div className="px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {t('ui.liveGrid.filter.groups')}
                </div>
                {namedGroups.map((group) => {
                  const checkedCount = group.cameraIds.filter((id) => draft.has(id)).length;
                  return (
                    <label key={group.id} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-800 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={checkedCount === group.cameraIds.length}
                        ref={(el) => {
                          if (el) el.indeterminate = checkedCount > 0 && checkedCount < group.cameraIds.length;
                        }}
                        onChange={(e) => setMany(group.cameraIds, e.target.checked)}
                        className="w-3.5 h-3.5 accent-cyan-500 shrink-0"
                      />
                      <FolderTree className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="font-semibold text-slate-200 truncate flex-1" title={group.name}>{group.name}</span>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">{checkedCount}/{group.cameraIds.length}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {groups.map((group) => {
              if (group.id === null) {
                return (
                  <div key="standalone">
                    {groups.length > 1 && (
                      <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {t('ui.liveGrid.filter.standalone', { count: group.cameras.length })}
                      </div>
                    )}
                    {group.cameras.map(row)}
                  </div>
                );
              }
              const groupId = group.id;
              const ids = group.cameras.map((c) => c.id);
              const checkedCount = ids.filter((id) => draft.has(id)).length;
              const isOpen = isSearching || expanded.has(groupId);
              return (
                <div key={groupId}>
                  <div className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-slate-800 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(groupId)) next.delete(groupId);
                          else next.add(groupId);
                          return next;
                        })
                      }
                      className="p-0.5 text-slate-400 hover:text-slate-200"
                    >
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                    <input
                      type="checkbox"
                      checked={checkedCount === ids.length}
                      ref={(el) => {
                        if (el) el.indeterminate = checkedCount > 0 && checkedCount < ids.length;
                      }}
                      onChange={(e) => setMany(ids, e.target.checked)}
                      className="w-3.5 h-3.5 accent-cyan-500 shrink-0"
                    />
                    <HardDrive className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="font-semibold text-slate-200 truncate" title={group.name ?? ''}>{group.name}</span>
                    {group.device && (
                      <span className="text-[10px] font-mono text-slate-500 truncate" title={t('ui.liveGrid.filter.deviceInfo', { ip: group.device.ipAddress, n: group.device.totalChannels })}>
                        {t('ui.liveGrid.filter.deviceInfo', { ip: group.device.ipAddress, n: group.device.totalChannels })}
                      </span>
                    )}
                    <span className="flex-1" />
                    <span className="text-[10px] font-mono text-slate-500 shrink-0" title={t('ui.liveGrid.filter.countHint', { a: checkedCount, b: ids.length })}>{checkedCount}/{ids.length}</span>
                  </div>
                  {isOpen && <div className="pl-5">{group.cameras.map(row)}</div>}
                </div>
              );
            })}
          </div>

          <div className="p-2 border-t border-slate-800 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(new Set());
                setDraftOffline(false);
              }}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              {t('ui.liveGrid.filter.clear')}
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium"
            >
              {draft.size > 0 ? t('ui.liveGrid.filter.applyCount', { count: draft.size }) : t('ui.liveGrid.filter.applyAll')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
