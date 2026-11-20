import { useTranslation } from 'react-i18next'

/** The last delivery to Telegram: ok, or why it failed (so a group that stopped accepting messages is noticed). */
export function TelegramStatusCard({ last }: { last: { at: string; ok: boolean; chatId: string; description?: string } | null | undefined }) {
  const { t, i18n } = useTranslation()
  return (
    <div className={`rounded-lg border p-4 ${!last ? 'border-white/15 bg-white/[0.03]' : last.ok ? 'border-emerald-700/50 bg-emerald-950/30' : 'border-red-700/60 bg-red-950/40'}`}>
      <h3 className="font-semibold text-white mb-1">{t('ui.escalation.telegramStatus')}</h3>
      {!last ? <p className="text-sm text-slate-400">{t('ui.escalation.telegramNoResult')}</p> : (
        <p className={`text-sm ${last.ok ? 'text-emerald-200' : 'text-red-200'}`}>
          {last.ok ? t('ui.escalation.telegramOk') : t('ui.escalation.telegramFailed')} · {new Date(last.at).toLocaleString(i18n.language)}
          {!last.ok && last.description && <span className="block text-xs mt-1 font-mono">{last.description}</span>}
        </p>
      )}
    </div>
  )
}
