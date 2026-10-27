import { useState, useEffect, useRef } from 'react';

interface CountUpValueProps {
  value?: number | null;
  isLoading?: boolean;
  duration?: number;
  formatter?: (val: number) => string;
  className?: string;
  prefix?: string;
  suffix?: string;
}

export default function CountUpValue({
  value,
  isLoading = false,
  duration = 600,
  formatter = (v) => Math.round(v).toLocaleString(),
  className = '',
  prefix = '',
  suffix = '',
}: CountUpValueProps) {
  const isDataAvailable = typeof value === 'number' && !isNaN(value);
  const targetVal = isDataAvailable ? (value as number) : 0;

  const [displayValue, setDisplayValue] = useState<number>(0);
  const currentValRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const isSimulatingRef = useRef<boolean>(false);
  const hasLoadedRef = useRef<boolean>(isDataAvailable);

  useEffect(() => {
    // 1. Data is available OR page has already loaded before: NO FAKE RANDOM TICKER
    // Smoothly animate directly from startValue to actual real targetVal
    if (isDataAvailable || hasLoadedRef.current) {
      hasLoadedRef.current = true;
      isSimulatingRef.current = false;
      const startValue = currentValRef.current;
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = startValue + (targetVal - startValue) * easeOut;

        setDisplayValue(current);
        currentValRef.current = current;

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(animate);
        } else {
          setDisplayValue(targetVal);
          currentValRef.current = targetVal;
        }
      };

      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      animFrameRef.current = requestAnimationFrame(animate);
    } 
    // 2. Cold first load while waiting for API response: RUN FAKE DYNAMIC TICKER TO HOLD INTEREST
    else if (isLoading) {
      isSimulatingRef.current = true;
      const startTime = performance.now();

      const simulate = (currentTime: number) => {
        if (!isSimulatingRef.current) return;
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / 2500, 1);
        const easeOut = 1 - Math.pow(1 - progress, 2);
        
        // Micro-jitter to create an engaging live calculation ticker effect
        const base = Math.round(easeOut * 888);
        const jitter = Math.floor(Math.random() * 15) - 7;
        const simulatedVal = Math.max(0, base + (progress < 0.9 ? jitter : 0));

        setDisplayValue(simulatedVal);
        currentValRef.current = simulatedVal;

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(simulate);
        }
      };

      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
      animFrameRef.current = requestAnimationFrame(simulate);
    }

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [value, isDataAvailable, targetVal, isLoading, duration]);

  return (
    <span className={className}>
      {prefix}
      {formatter(displayValue)}
      {suffix}
    </span>
  );
}
