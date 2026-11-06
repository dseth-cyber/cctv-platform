import { useTranslation } from 'react-i18next';

/** Which channels of a recorder have a camera in use. */
export function ChannelChecklist({ total, enabled, onChange, statusOf }: {
  total: number;
  enabled: number[];
  onChange: (next: number[]) => void;
  /** Optional line under a channel, e.g. its live status. */
  statusOf?: (channel: number) => { text: string; dotClass: string } | null;
}) {
  const { t } = useTranslation();
  const channels = Array.from({ length: total }, (_, i) => i + 1);
  const on = new Set(enabled);
  const toggle = (channel: number) => {
    const next = new Set(on);
    if (next.has(channel)) next.delete(channel);
    else next.add(channel);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-300">{t('ui.deviceManagement.channelsInUse', { n: on.size, total })}</span>
        <span className="flex items-center gap-2">
          <button type="button" onClick={() => onChange(channels)} className="text-xs text-cyan-400 hover:text-cyan-300">{t('ui.deviceManagement.channelsAll')}</button>
          <button type="button" onClick={() => onChange([])} className="text-xs text-slate-400 hover:text-slate-200">{t('ui.deviceManagement.channelsNone')}</button>
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
        {channels.map((channel) => {
          const status = statusOf?.(channel);
          return (
            <label
              key={channel}
              className={`px-2 py-1.5 rounded-lg border cursor-pointer select-none transition ${on.has(channel) ? 'bg-slate-900 border-slate-700 hover:border-cyan-500' : 'bg-slate-950/40 border-dashed border-slate-800 text-slate-500'}`}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <input type="checkbox" checked={on.has(channel)} onChange={() => toggle(channel)} className="rounded border-slate-700 bg-slate-950 text-cyan-600 focus:ring-0" />
                {t('ui.deviceManagement.channelN', { n: channel })}
              </span>
              {status && (
                <span className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dotClass}`} />
                  <span className="truncate">{status.text}</span>
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
