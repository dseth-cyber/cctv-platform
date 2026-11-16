import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** True on phones and tablets: no mouse to hover with, so hover-revealed controls never appear by themselves. */
export function isTouchOnly(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches;
}

/**
 * Overlays on a video (name, time, buttons) on a touch screen: shown, then hidden after `ms` without a touch, and
 * shown again by a tap — the same as the fullscreen dock. With a mouse nothing changes: always visible.
 * Spread `onPointerDown={reveal}` on the area that holds the video; give the overlays `visible`.
 */
export function useTouchAutoHide(enabled = true, ms = 3000) {
  const touch = useMemo(isTouchOnly, []);
  const active = touch && enabled;
  const [shown, setShown] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  const reveal = useCallback(() => {
    setShown(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(false), ms);
  }, [ms]);

  useEffect(() => {
    if (active) reveal();
    else {
      window.clearTimeout(timer.current);
      setShown(true);
    }
    return () => window.clearTimeout(timer.current);
  }, [active, reveal]);

  return { visible: !active || shown, reveal: active ? reveal : undefined, touch };
}
