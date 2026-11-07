import React, { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { imageServiceApi } from '@/services/imageServiceApi';

interface SecurityWatermarkProps {
  className?: string;
  customSessionId?: string;
  opacity?: number;
}

/**
 * Dynamic Anti-Screen-Capture Watermark Overlay [ENH-04].
 * Displays operator identity, session/IP token, and live Asia/Bangkok timestamp.
 * Position subtly shifts every 30 seconds to prevent static cropping.
 * pointer-events: none ensures zero interference with video controls and PTZ gestures.
 */
export const SecurityWatermark: React.FC<SecurityWatermarkProps> = ({
  className = '',
  customSessionId,
  opacity = 0.18,
}) => {
  const { user } = useAuth();
  const { data: publicConfig } = useQuery<any>({
    queryKey: ['system-public-config'],
    queryFn: () => imageServiceApi.getSystemBranding(),
    staleTime: 60_000,
  });
  const [liveTime, setLiveTime] = useState<string>('');
  const [positionStep, setPositionStep] = useState<number>(0);

  // Persistent session identifier for client trace
  const sessionId = useMemo(() => {
    if (customSessionId) return customSessionId;
    let stored = sessionStorage.getItem('cctv_client_session_id');
    if (!stored) {
      stored = `SES-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      sessionStorage.setItem('cctv_client_session_id', stored);
    }
    return stored;
  }, [customSessionId]);

  // Update Asia/Bangkok live timestamp every second
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // Enforce Asia/Bangkok (UTC+7)
      const formatted = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now);
      setLiveTime(`${formatted} (ICT)`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Subtle position jitter every 30s to defeat automated crop guards
  useEffect(() => {
    const shiftInterval = setInterval(() => {
      setPositionStep((prev) => (prev + 1) % 4);
    }, 30000);
    return () => clearInterval(shiftInterval);
  }, []);

  const identityText = useMemo(() => {
    const identifier = user?.username || user?.email || user?.role || 'Authorized-Operator';
    const roleTag = user?.role ? `[${user.role.toUpperCase()}]` : '';
    return `${identifier} ${roleTag}`.trim();
  }, [user]);

  const watermarkString = `${identityText} • ${sessionId} • ${liveTime}`;

  // Offsets for the 30-second cycle
  const offsetTransforms = [
    'translate(0px, 0px)',
    'translate(15px, 12px)',
    'translate(-12px, 8px)',
    'translate(8px, -10px)',
  ];

  if (publicConfig?.watermark_enabled?.value !== true) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        opacity,
        transform: offsetTransforms[positionStep],
        transition: 'transform 2s ease-in-out',
      }}
      className={`absolute inset-0 pointer-events-none select-none z-20 overflow-hidden flex flex-col justify-around py-4 ${className}`}
    >
      {/* 3 rows of angled watermark text across the video viewport */}
      {[0, 1, 2].map((rowIdx) => (
        <div
          key={rowIdx}
          style={{ transform: 'rotate(-22deg)' }}
          className={`flex items-center justify-around whitespace-nowrap text-white font-mono font-bold tracking-wider drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${
            rowIdx % 2 === 0 ? 'text-[11px] sm:text-xs' : 'text-[10px] sm:text-[11px] pl-16'
          }`}
        >
          <span>{watermarkString}</span>
          <span className="hidden sm:inline mx-8">•</span>
          <span className="hidden sm:inline">{watermarkString}</span>
          <span className="hidden md:inline mx-8">•</span>
          <span className="hidden md:inline">{watermarkString}</span>
        </div>
      ))}
    </div>
  );
};
