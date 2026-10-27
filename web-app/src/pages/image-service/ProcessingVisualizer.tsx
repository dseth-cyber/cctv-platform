import { useState, useEffect, useRef } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { Settings2 } from 'lucide-react';

interface Props {
  active: boolean;
  style?: string;
  onStyleChange?: (style: string) => void;
}

const STYLES = [
  { key: 'ring', label: 'Progress Ring' },
  { key: 'flow', label: 'Data Flow' },
  { key: 'pulse', label: 'Pulse Wave' },
  { key: 'particle', label: 'Particle' },
];

function ProgressRing({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center h-full gap-6">
      <div className="relative">
        <svg width="120" height="120">
          <defs>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
          {active && (
            <>
              <circle cx="60" cy="60" r="48" fill="none" stroke="url(#ringGrad)" strokeWidth="6"
                strokeLinecap="round" strokeDasharray="80 220" filter="url(#glow)"
                className="animate-[spin_2s_linear_infinite]" style={{ transformOrigin: '60px 60px' }} />
              <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(6,182,212,0.15)" strokeWidth="1"
                strokeDasharray="6 4" className="animate-[spin_6s_linear_infinite_reverse]" style={{ transformOrigin: '60px 60px' }} />
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {active
            ? <span className="text-xs text-cyan-400 animate-pulse font-medium">Processing</span>
            : <span className="text-xs text-gray-500 font-medium">Idle</span>}
        </div>
      </div>
      {active && (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex gap-1">
              {[0, 1, 2, 3, 4].map(j => (
                <div key={j} className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-pulse"
                  style={{ animationDelay: `${(i * 5 + j) * 0.1}s` }} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DataFlow({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex items-center gap-1">
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} className="flex flex-col gap-1">
            {[0, 1, 2].map(j => (
              <div key={j}
                className={`w-3 h-3 rounded-sm transition-all duration-500
                  ${active ? 'animate-pulse' : 'opacity-20'}`}
                style={{
                  backgroundColor: active ? ['#06b6d4', '#8b5cf6', '#3b82f6', '#10b981'][j % 4] : '#374151',
                  opacity: active ? undefined : 0.15,
                  animationDelay: `${(i * 0.15) + (j * 0.1)}s`,
                  animationDuration: '1.2s',
                }} />
            ))}
          </div>
        ))}
        {active && (
          <div className="ml-3 flex flex-col items-start">
            <span className="text-[10px] text-cyan-400 animate-pulse">Processing...</span>
            <div className="flex gap-0.5 mt-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-1 h-1 rounded-full bg-cyan-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
            </div>
          </div>
        )}
      </div>
      {active && <style>{`
        @keyframes flowPulse { 0%,100% { opacity:0.3; } 50% { opacity:1; } }
      `}</style>}
    </div>
  );
}

function PulseWave({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="relative">
        {active && [0, 1, 2].map(i => (
          <div key={i} className="absolute inset-0 rounded-full border-2 border-cyan-400/30 animate-ping"
            style={{
              animationDuration: '2.5s',
              animationDelay: `${i * 0.8}s`,
              width: 80 + i * 30,
              height: 80 + i * 30,
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
            }} />
        ))}
        <div className={`relative w-16 h-16 rounded-full flex items-center justify-center z-10
          ${active
            ? 'bg-gradient-to-br from-cyan-500 to-blue-600 shadow-[0_0_30px_rgba(6,182,212,0.5)]'
            : 'bg-gray-700/50'}`}>
          <div className={`w-3 h-3 rounded-full ${active ? 'bg-white animate-pulse' : 'bg-gray-500'}`} />
        </div>
      </div>
      {active && (
        <div className="ml-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400">Active</span>
          </div>
          <div className="flex gap-0.5 mt-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="w-1 rounded-full bg-cyan-400 animate-pulse"
                style={{
                  height: 6 + Math.sin(i * 0.8) * 10,
                  animationDelay: `${i * 0.08}s`,
                  opacity: 0.4 + Math.sin(i * 0.5) * 0.4,
                }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ParticleEffect({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; life: number; max: number; color: string }>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    const W = canvas.width, H = canvas.height;
    const colors = ['#06b6d4', '#8b5cf6', '#3b82f6', '#10b981'];
    const particles = particlesRef.current;

    const animate = () => {
      ctx.clearRect(0, 0, W, H);

      if (active && particles.length < 50) {
        particles.push({
          x: Math.random() * W, y: H + 5,
          vx: (Math.random() - 0.5) * 1.5, vy: -(1 + Math.random() * 2.5),
          life: 0, max: 50 + Math.random() * 50,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life++;
        const a = 1 - p.life / p.max;
        if (a <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = a * 0.7;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 + a * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a * 0.12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8 + a * 8, 0, Math.PI * 2);
        ctx.fill();
      }

      if (active) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Processing...', W / 2, H / 2);
      }

      ctx.globalAlpha = 1;
      animRef.current = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

export default function ProcessingVisualizer(props: Props) {
  const [style, setStyle] = useState(props.style ?? 'ring');
  const [showPicker, setShowPicker] = useState(false);
  const [previewing, setPreviewing] = useState(true);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { if (props.style) setStyle(props.style); }, [props.style]);

  useEffect(() => {
    setPreviewing(true);
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setPreviewing(false), 4000);
    return () => clearTimeout(previewTimer.current);
  }, [style]);

  const handleChange = (s: string) => {
    setStyle(s);
    setShowPicker(false);
    props.onStyleChange?.(s);
  };

  const isActive = props.active || previewing;

  return (
    <div className="relative h-full">
      <button onClick={() => setShowPicker(!showPicker)}
        className="absolute top-1 right-1 z-10 p-1 rounded-md opacity-40 hover:opacity-100 transition-opacity bg-black/30">
        <Settings2 size={12} className="text-white" />
      </button>
      {showPicker && (
        <div className="absolute top-7 right-1 z-20 rounded-lg border border-white/10 bg-slate-900/95 backdrop-blur-md p-1.5 shadow-xl">
          {STYLES.map(s => (
            <button key={s.key} onClick={() => handleChange(s.key)}
              className={`block w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors
                ${style === s.key ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-300 hover:bg-white/5'}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {style === 'ring' && <ProgressRing active={isActive} />}
      {style === 'flow' && <DataFlow active={isActive} />}
      {style === 'pulse' && <PulseWave active={isActive} />}
      {style === 'particle' && <ParticleEffect active={isActive} />}
    </div>
  );
}
