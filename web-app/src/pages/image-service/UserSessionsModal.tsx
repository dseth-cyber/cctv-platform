import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LogOut, Monitor } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { Modal } from '@/components/ui';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';

interface Session { id: string; loginAt: string; lastActiveAt: string; ipAddress: string | null; userAgent: string | null; current: boolean }

/** A short device name from the browser's user agent: "Chrome · Windows". */
function deviceName(ua: string | null): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

/** The devices a person is signed in on; an administrator can sign one out (it stops working at once). */
export function UserSessionsModal({ target, onClose }: { target: { id: string; username: string } | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canRevoke = hasPermission(user, 'users:update');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['user-sessions', target?.id],
    queryFn: () => imageServiceApi.getUserSessions(target!.id),
    enabled: !!target,
  });
  const sessions: Session[] = data?.items ?? [];
  const limit: number | undefined = data?.limit;

  const revoke = useMutation({
    mutationFn: (sid: string) => imageServiceApi.revokeUserSession(target!.id, sid),
    onSuccess: () => {
      toast.success(t('ui.userSessions.revoked'));
      setConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ['user-sessions', target?.id] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('ui.userSessions.revokeFailed')); },
  });

  return (
    <Modal isOpen={!!target} onClose={() => { setConfirmId(null); onClose(); }} size="2xl" title={t('ui.userSessions.title', { username: target?.username ?? '' })}>
      <div className="space-y-3">
        <p className={`text-xs ${themeConfig.text.secondary}`}>
          {limit === 0 ? t('ui.userSessions.noLimit') : t('ui.userSessions.limit', { count: limit ?? 0 })}
        </p>
        {isLoading ? (
          <div className={`text-sm ${themeConfig.text.secondary}`}>{t('common.loading')}</div>
        ) : sessions.length === 0 ? (
          <div className={`text-sm py-4 text-center ${themeConfig.text.secondary}`}>{t('ui.userSessions.none')}</div>
        ) : (
          <div className="divide-y divide-white/5">
            {sessions.map((s) => (
              <div key={s.id} data-session={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <Monitor size={16} className={themeConfig.text.secondary} />
                  <div className="min-w-0">
                    <div className={`text-sm ${themeConfig.text.primary}`}>
                      {deviceName(s.userAgent)} {s.ipAddress ? <span className={`text-xs ${themeConfig.text.secondary}`}>· {s.ipAddress}</span> : null}
                      {s.current && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{t('ui.userSessions.thisDevice')}</span>}
                    </div>
                    <div className={`text-[11px] ${themeConfig.text.secondary}`}>
                      {t('ui.userSessions.signedIn')} {formatDateTime(s.loginAt, i18n.language)} · {t('ui.userSessions.lastUsed')} {formatDateTime(s.lastActiveAt, i18n.language)}
                    </div>
                  </div>
                </div>
                {canRevoke && !s.current && (
                  confirmId === s.id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => setConfirmId(null)} className={`px-2.5 py-1 rounded-lg text-xs border ${themeConfig.cardBorder} ${themeConfig.text.secondary}`}>{t('common.cancel')}</button>
                      <button type="button" data-session-confirm={s.id} disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-40">{t('ui.userSessions.confirmRevoke')}</button>
                    </div>
                  ) : (
                    <button type="button" data-session-revoke={s.id} onClick={() => setConfirmId(s.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/15 border border-rose-500/30 hover:bg-rose-500/25 text-rose-300 shrink-0">
                      <LogOut size={13} />{t('ui.userSessions.revoke')}
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
