import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export interface AlertSourceInfo { kind: 'camera' | 'device' | 'incident' | 'provider' | 'system' | 'deleted' | 'unknown'; name: string | null; link: string | null }

/** What an alert is about, in words: "Camera: MD - Ch 4" linking to it, "System: disk space check", "Deleted camera". */
export function alertSourceText(info: AlertSourceInfo | null | undefined, raw: string | null | undefined, t: (k: string, o?: any) => string): string {
  if (!info) return raw ? raw : '—';
  if (info.kind === 'system') return `${t('ui.alertSource.kind.system')}: ${t(`ui.alertSource.system.${info.name}`, { defaultValue: info.name ?? '' })}`;
  if (info.kind === 'deleted') return info.name ? `${t('ui.alertSource.kind.deleted')}: ${info.name}` : t('ui.alertSource.kind.deleted');
  if (info.kind === 'unknown') return info.name ?? raw ?? '—';
  return `${t(`ui.alertSource.kind.${info.kind}`)}: ${info.name ?? '—'}`;
}

export function AlertSource({ info, raw, className = '' }: { info?: AlertSourceInfo | null; raw?: string | null; className?: string }) {
  const { t } = useTranslation();
  const text = alertSourceText(info, raw, t);
  if (info?.link) {
    return (
      <Link data-alert-source={info.kind} to={info.link} onClick={(e) => e.stopPropagation()} title={raw ?? undefined}
        className={`underline decoration-dotted underline-offset-2 hover:text-cyan-300 ${className}`}>
        {text}
      </Link>
    );
  }
  return <span data-alert-source={info?.kind ?? 'none'} title={raw ?? undefined} className={info?.kind === 'deleted' ? `opacity-60 ${className}` : className}>{text}</span>;
}
