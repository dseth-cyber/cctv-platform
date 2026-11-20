import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/contexts/ToastContext'
import { imageServiceApi } from '@/services/imageServiceApi'
import { Button, Modal } from '@/components/ui'
import { CheckCircle, Copy } from 'lucide-react'

/**
 * Links the signed-in person's Telegram to their account: a one-time code (10 minutes) sent to the bot as
 * "/link <code>". Then reminders can reach them in a private chat, and "✅ รับทราบ" buttons act as this account.
 */
export default function LinkTelegramModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [code, setCode] = useState<string | null>(null)
  const { data: status } = useQuery({ queryKey: ['telegram-link'], queryFn: imageServiceApi.getTelegramLink, refetchInterval: code ? 5_000 : false })
  const make = useMutation({
    mutationFn: imageServiceApi.createTelegramLinkCode,
    onSuccess: (r: any) => setCode(r.code),
    onError: (e: any) => { if (!e?._handled) toast.error(e?.response?.data?.message || t('common.error')) },
  })
  const unlink = useMutation({
    mutationFn: imageServiceApi.unlinkTelegram,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['telegram-link'] }); setCode(null); toast.success(t('ui.escalation.unlinked')) },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')) },
  })
  const command = code ? `/link ${code}` : ''

  return (
    <Modal isOpen onClose={onClose} title={t('ui.escalation.linkTelegram')} size="md">
      <div className="space-y-4 text-sm text-white">
        {status?.linked ? (
          <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3">
            <p className="flex items-center gap-2 text-emerald-200"><CheckCircle size={16} />{t('ui.escalation.linkedAs', { name: status.firstName || status.username || status.telegramId })}</p>
            <p className="text-xs text-slate-300 mt-1">{t('ui.escalation.linkedHint')}</p>
          </div>
        ) : (
          <p className="text-slate-300">{t('ui.escalation.linkIntro')}</p>
        )}
        {code ? (
          <div className="space-y-2">
            <p>{t('ui.escalation.linkStep1')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-center text-lg font-mono tracking-widest rounded bg-black/40 border border-white/20 py-2">{command}</code>
              <Button variant="secondary" size="sm" title={t('ui.escalation.copy')}
                onClick={() => navigator.clipboard?.writeText(command).then(() => toast.success(t('ui.escalation.copied'))).catch(() => {})}>
                <Copy size={14} />
              </Button>
            </div>
            <p className="text-xs text-slate-400">{t('ui.escalation.linkExpires')}</p>
          </div>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          {status?.linked && <Button variant="secondary" className="!text-red-300" onClick={() => unlink.mutate()} disabled={unlink.isPending}>{t('ui.escalation.unlink')}</Button>}
          <Button onClick={() => make.mutate()} disabled={make.isPending}>{status?.linked ? t('ui.escalation.relink') : t('ui.escalation.getCode')}</Button>
          <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Modal>
  )
}
