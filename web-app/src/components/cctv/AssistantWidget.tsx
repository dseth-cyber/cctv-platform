import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot, Loader2, Send, Sparkles, X, Radio, ArrowRight } from 'lucide-react';
import { imageServiceApi } from '@/services/imageServiceApi';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/App';
import { CameraLiveModal } from '@/components/cctv/CameraLiveModal';

interface Item { label: string; value?: string; tone?: 'bad' | 'warn' | 'ok'; link?: string; hint?: string }
type Action = { kind: 'navigate'; label: string; path: string } | { kind: 'live'; label: string; cameraId: string; cameraName: string };
interface Answer { intent: string; title: string; text?: string; items?: Item[]; steps?: string[]; actions?: Action[]; suggestions: string[] }
type Msg = { from: 'me'; text: string; at: number } | { from: 'bot'; answer: Answer; at: number } | { from: 'bot'; error: string; at: number };

const POS_KEY = 'cctv_assistant_pos';
const BTN_W = 168, BTN_H = 36, PANEL_W = 420, PANEL_H = 600, MARGIN = 12, DRAG_THRESHOLD = 5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function loadPos(): { x: number; y: number } {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null');
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
  } catch { /* storage blocked */ }
  return { x: window.innerWidth - BTN_W - 24, y: window.innerHeight - BTN_H - 24 };
}
const TONE: Record<string, string> = { bad: 'text-rose-300', warn: 'text-amber-300', ok: 'text-emerald-300' };

/**
 * "Ask AI Assistant": a button that can be dragged anywhere (the place is remembered in this browser) and a chat
 * that answers from the system's own data, within the person's rights. Nothing is sent outside the server.
 */
export function AssistantWidget() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pos, setPos] = useState(loadPos);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ id: string; name: string } | null>(null);
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the button on screen when the window changes size.
  useEffect(() => {
    const onResize = () => setPos((p) => ({ x: clamp(p.x, MARGIN, window.innerWidth - BTN_W - MARGIN), y: clamp(p.y, MARGIN, window.innerHeight - BTN_H - MARGIN) }));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useLayoutEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs, busy]);

  const ask = async (text: string) => {
    if (busy) return;
    if (text.trim()) setMsgs((m) => [...m, { from: 'me', text: text.trim(), at: Date.now() }]);
    setInput('');
    setBusy(true);
    try {
      const data = await imageServiceApi.askAssistant(text.trim(), i18n.language);
      setMsgs((m) => [...m, { from: 'bot', answer: data as Answer, at: Date.now() }]);
    } catch (err: any) {
      setMsgs((m) => [...m, { from: 'bot', error: err?.response?.status === 429 ? t('ui.assistant.tooFast') : t('ui.assistant.failed'), at: Date.now() }]);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && msgs.length === 0) void ask('');
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, sx: e.clientX, sy: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setPos({ x: clamp(e.clientX - d.dx, MARGIN, window.innerWidth - BTN_W - MARGIN), y: clamp(e.clientY - d.dy, MARGIN, window.innerHeight - BTN_H - MARGIN) });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* only a convenience */ }
    } else {
      toggle();
    }
  };

  if (!user || !hasPermission(user, 'cameras:read')) return null;

  // The window opens beside the button, on whichever side has room.
  const vw = window.innerWidth, vh = window.innerHeight;
  const panelW = Math.min(PANEL_W, vw - 2 * MARGIN), panelH = Math.min(PANEL_H, vh - 2 * MARGIN);
  // Below or above the button when it fits; otherwise beside it, so the window never covers the button.
  const fitsBelow = vh - (pos.y + BTN_H + 8) - MARGIN >= panelH;
  const fitsAbove = pos.y - 8 - MARGIN >= panelH;
  let panelLeft: number, panelTop: number;
  if (fitsBelow || fitsAbove) {
    panelLeft = clamp(pos.x + BTN_W - panelW, MARGIN, vw - panelW - MARGIN);
    panelTop = fitsBelow && !(fitsAbove && pos.y > vh / 2) ? pos.y + BTN_H + 8 : pos.y - panelH - 8;
  } else {
    const leftRoom = pos.x - 8 - MARGIN, rightRoom = vw - (pos.x + BTN_W + 8) - MARGIN;
    panelLeft = leftRoom >= rightRoom ? clamp(pos.x - 8 - panelW, MARGIN, vw - panelW - MARGIN) : clamp(pos.x + BTN_W + 8, MARGIN, vw - panelW - MARGIN);
    panelTop = clamp(pos.y + BTN_H / 2 - panelH / 2, MARGIN, vh - panelH - MARGIN);
  }
  const last = [...msgs].reverse().find((m): m is Extract<Msg, { answer: Answer }> => 'answer' in m);

  return (
    <>
      <button
        type="button"
        data-assistant-button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={t('ui.assistant.dragHint')}
        style={{ left: pos.x, top: pos.y, width: BTN_W, height: BTN_H, touchAction: 'none' }}
        className="fixed z-[62] inline-flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-semibold shadow-lg shadow-cyan-900/40 hover:brightness-110 select-none cursor-grab active:cursor-grabbing"
      >
        <Sparkles size={14} /> {t('ui.assistant.button')}
      </button>

      {open && (
        <div data-assistant-panel style={{ left: panelLeft, top: panelTop, width: panelW, height: panelH }}
          className="fixed z-[61] flex flex-col rounded-2xl border border-slate-700 bg-slate-950/95 backdrop-blur shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-gradient-to-r from-slate-900 to-indigo-950/60">
            <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-300"><Bot size={18} /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-100">{t('ui.assistant.title')}</p>
              <p className="text-[11px] text-slate-400 truncate">{t('ui.assistant.subtitle')}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-full hover:bg-slate-800 text-slate-300" aria-label={t('common.close')}><X size={16} /></button>
          </div>

          <div ref={listRef} data-assistant-messages className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {msgs.map((m, i) => m.from === 'me' ? (
              <div key={i} className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-sm bg-gradient-to-r from-cyan-600 to-blue-600 px-3 py-2 text-sm text-white">{m.text}</div></div>
            ) : 'error' in m ? (
              <div key={i} className="text-xs text-rose-300">{m.error}</div>
            ) : (
              <div key={i} data-assistant-answer={m.answer.intent} className="rounded-2xl rounded-bl-sm border border-slate-800 bg-slate-900/80 px-3 py-2.5 text-sm text-slate-200 space-y-2">
                <p className="font-semibold text-slate-100">{m.answer.title}</p>
                {m.answer.text && <p className="text-xs text-slate-400">{m.answer.text}</p>}
                {m.answer.steps && m.answer.steps.length > 0 && (
                  <ol className="list-decimal pl-4 space-y-1 text-xs text-slate-300">{m.answer.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
                )}
                {m.answer.items && m.answer.items.length > 0 && (
                  <div className="space-y-1.5">
                    {m.answer.items.map((it, j) => (
                      <div key={j} className="rounded-lg bg-slate-950/70 border border-slate-800 px-2.5 py-1.5">
                        <div className="flex items-start justify-between gap-2 text-xs">
                          {it.link ? <Link to={it.link} onClick={() => setOpen(false)} className="text-slate-200 hover:text-cyan-300 hover:underline">{it.label}</Link> : <span className="text-slate-200">{it.label}</span>}
                          {it.value && <span className={`text-right font-medium ${TONE[it.tone ?? ''] ?? 'text-cyan-300'}`}>{it.value}</span>}
                        </div>
                        {it.hint && <p className="text-[11px] text-slate-500 mt-0.5">💡 {it.hint}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {m.answer.actions && m.answer.actions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {m.answer.actions.map((a, j) => (
                      <button key={j} type="button" data-assistant-action={a.kind}
                        onClick={() => { if (a.kind === 'live') setLive({ id: a.cameraId, name: a.cameraName }); else { navigate(a.path); setOpen(false); } }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20">
                        {a.kind === 'live' ? <Radio size={12} /> : <ArrowRight size={12} />} {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> {t('ui.assistant.thinking')}</div>}
          </div>

          {last && last.answer.suggestions.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-800">
              <p className="text-[10px] text-slate-500 mb-1.5">✨ {t('ui.assistant.suggested')}</p>
              <div className="flex flex-wrap gap-1.5">
                {last.answer.suggestions.map((s) => (
                  <button key={s} type="button" data-assistant-suggestion onClick={() => ask(s)} disabled={busy}
                    className="px-2.5 py-1 rounded-full text-[11px] border border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200 disabled:opacity-50">{s}</button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); if (input.trim()) void ask(input); }} className="flex items-center gap-2 px-3 py-3 border-t border-slate-800">
            <input data-assistant-input value={input} onChange={(e) => setInput(e.target.value)} maxLength={300} placeholder={t('ui.assistant.placeholder')}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500" />
            <button type="submit" disabled={busy || !input.trim()} className="p-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40" aria-label={t('ui.assistant.send')}><Send size={16} /></button>
          </form>
        </div>
      )}

      <CameraLiveModal camera={live ? { id: live.id, name: live.name } : null} onClose={() => setLive(null)} />
    </>
  );
}
