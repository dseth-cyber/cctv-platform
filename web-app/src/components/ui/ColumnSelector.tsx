import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { Settings2, GripVertical, Check } from 'lucide-react';

export interface ColumnDef {
  key: string;
  label: string;
  /** Always shown and not reorderable (e.g. select checkbox, row actions). */
  fixed?: boolean;
}

interface ColumnSelectorProps {
  columns: ColumnDef[];
  /** Ordered list of column keys (fixed columns may be omitted). */
  order: string[];
  /** Keys that are currently hidden. */
  hidden: string[];
  onChange: (order: string[], hidden: string[]) => void;
  label?: string;
  buttonClassName?: string;
  /** Show drag handles + allow drag-to-reorder (default true). Set false for a
   *  pure show/hide checkbox list (e.g. toggling which filters are visible). */
  reorderable?: boolean;
  /** Which edge the popover aligns to. Use 'left' for a left-positioned button
   *  so the panel opens rightward instead of under the sidebar (default 'right'). */
  align?: 'left' | 'right';
}

// Table column show/hide + drag-to-reorder popover. Reordering uses native HTML5
// drag events (no external dnd dependency). Fixed columns are listed but locked.
export function ColumnSelector({ columns, order, hidden, onChange, label, buttonClassName, reorderable = true, align = 'right' }: ColumnSelectorProps) {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const [open, setOpen] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // themeConfig.card is semi-transparent (glassmorphism), which let the table
  // behind the popover show through. Use a solid, theme-aware surface instead.
  const panelBg = themeConfig.name === 'light' ? 'bg-white' : themeConfig.name === 'dark' ? 'bg-gray-800' : 'bg-slate-900';

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const byKey = new Map(columns.map(c => [c.key, c]));
  // Render in the saved order; append any columns missing from `order` (e.g. a
  // newly added column) so they never silently disappear.
  const orderedKeys = [
    ...order.filter(k => byKey.has(k)),
    ...columns.filter(c => !order.includes(c.key)).map(c => c.key),
  ];

  const toggleHidden = (key: string) => {
    const col = byKey.get(key);
    if (col?.fixed) return;
    onChange(order.length ? order : orderedKeys, hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key]);
  };

  const handleDrop = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); return; }
    const src = byKey.get(dragKey);
    const tgt = byKey.get(targetKey);
    if (src?.fixed || tgt?.fixed) { setDragKey(null); return; }
    const next = [...orderedKeys];
    const from = next.indexOf(dragKey);
    const to = next.indexOf(targetKey);
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    setDragKey(null);
    onChange(next, hidden);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={buttonClassName ?? `px-3 py-2 rounded-md text-xs flex items-center gap-1.5 border ${themeConfig.inputBorder} ${themeConfig.text.secondary} hover:bg-white/5 transition-colors h-[38px]`}>
        <Settings2 size={13} /> {label ?? t('common.tableSettings', 'ตั้งค่าตาราง')}
      </button>

      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-50 mt-1 w-60 rounded-lg border ${themeConfig.cardBorder} ${panelBg} shadow-xl p-2`}>
          <div className={`flex items-center justify-between px-1.5 pb-1.5 mb-1 border-b ${themeConfig.cardBorder}`}>
            <span className={`text-[11px] font-semibold ${themeConfig.text.secondary}`}>
              {t('common.tableSettings', 'ตั้งค่าตาราง')}
            </span>
            {reorderable && (
              <span className={`text-[10px] ${themeConfig.text.secondary} opacity-70`}>
                {t('common.dragToReorder', 'ลากเพื่อเรียงลำดับ')}
              </span>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {orderedKeys.map(key => {
              const col = byKey.get(key);
              if (!col) return null;
              const isHidden = hidden.includes(key);
              return (
                <div key={key}
                  draggable={reorderable && !col.fixed}
                  onDragStart={reorderable ? () => setDragKey(key) : undefined}
                  onDragOver={reorderable ? (e => { if (!col.fixed) e.preventDefault(); }) : undefined}
                  onDrop={reorderable ? (() => handleDrop(key)) : undefined}
                  className={`flex items-center gap-2 px-1.5 py-1.5 rounded-md text-xs select-none ${col.fixed ? 'opacity-60' : reorderable ? 'cursor-grab hover:bg-white/5' : 'hover:bg-white/5'} ${dragKey === key ? 'opacity-40' : ''}`}>
                  {reorderable && <GripVertical size={13} className={`shrink-0 ${col.fixed ? 'opacity-20' : 'opacity-40'}`} />}
                  <button type="button" onClick={() => toggleHidden(key)} disabled={col.fixed}
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isHidden ? `${themeConfig.inputBorder}` : 'bg-cyan-500 border-cyan-500'} ${col.fixed ? 'cursor-not-allowed' : ''}`}>
                    {!isHidden && <Check size={11} className="text-white" />}
                  </button>
                  <span className={`truncate ${isHidden ? themeConfig.text.secondary : themeConfig.text.primary}`}>{col.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
