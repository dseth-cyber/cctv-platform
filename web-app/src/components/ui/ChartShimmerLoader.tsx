interface ChartShimmerLoaderProps {
  height?: number | string;
  type?: 'bar' | 'line' | 'pie';
}

export default function ChartShimmerLoader({ height = 220, type = 'bar' }: ChartShimmerLoaderProps) {
  return (
    <div
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
      className="w-full relative flex items-end justify-between gap-2.5 p-4 rounded-lg bg-slate-900/60 border border-cyan-500/20 overflow-hidden backdrop-blur-md"
    >
      {/* Animated Glowing Shimmer Sweep Overlay */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent animate-shimmer-slide" />

      {type === 'bar' && (
        <>
          {[45, 70, 35, 85, 55, 95, 75, 50, 80, 65, 90, 40].map((h, i) => (
            <div
              key={i}
              style={{
                height: `${h}%`,
                animationDelay: `${i * 0.1}s`,
              }}
              className="flex-1 rounded-t bg-gradient-to-t from-cyan-500/30 via-cyan-400/50 to-blue-500/70 animate-wave-bar shadow-[0_0_12px_rgba(6,182,212,0.3)]"
            />
          ))}
        </>
      )}

      {type === 'line' && (
        <div className="w-full h-full flex flex-col justify-between py-2">
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500/40 via-blue-500/70 to-purple-500/40 animate-pulse" />
          <div className="h-1 w-full bg-gradient-to-r from-purple-500/40 via-pink-500/70 to-cyan-500/40 animate-pulse translate-y-2" />
          <div className="h-1 w-full bg-gradient-to-r from-blue-500/40 via-cyan-500/70 to-indigo-500/40 animate-pulse -translate-y-2" />
        </div>
      )}

      {type === 'pie' && (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-28 h-28 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
        </div>
      )}
    </div>
  );
}
