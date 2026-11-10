import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';

/** http://ip[:port]/ for a device's own web page; port 80 is left out. */
export const deviceWebUrl = (ip: string, port?: number | null) => `http://${ip}${port && port !== 80 ? `:${port}` : ''}/`;

/**
 * Where to sign in for a camera: its recorder when it has one (a channel has no page of its own), otherwise the
 * camera's own address.
 */
export function cameraWebTarget(camera: any): { ip: string | null; port: number | null } {
  return {
    ip: camera?.device?.ipAddress || camera?.ipAddress || null,
    port: camera?.device ? camera.device.httpPort ?? null : null,
  };
}

/**
 * An IP that opens the device's web page in a new tab (from a browser on the device's LAN). Clicking it never
 * reaches the row or card it sits in, so it does not open a detail or fold a row.
 */
export function DeviceWebLink({ ip, port, label, className = '' }: { ip?: string | null; port?: number | null; label?: string; className?: string }) {
  const { t } = useTranslation();
  if (!ip) return <span className={className}>—</span>;
  return (
    <a
      data-device-web-link={ip}
      href={deviceWebUrl(ip, port)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={t('ui.deviceManagement.openDeviceWeb')}
      className={`inline-flex items-center gap-0.5 font-mono underline decoration-dotted underline-offset-2 hover:text-cyan-200 hover:decoration-solid ${className}`}
    >
      {label ?? ip}<ExternalLink className="w-3 h-3 flex-shrink-0" />
    </a>
  );
}
