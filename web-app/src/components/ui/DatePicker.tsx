import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { dayToText, textToDay } from '@/lib/dayText'

interface DatePickerProps {
  /** YYYY-MM-DD or '' */
  value: string
  onChange: (value: string) => void
  className?: string
  /** For tests and labels. */
  name?: string
}

const MONTHS: Record<string, string[]> = {
  th: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}
const DAYS: Record<string, string[]> = { th: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'], en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] }

const pad = (n: number) => String(n).padStart(2, '0')
const todayDay = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/**
 * A date (no time) typed as dd/mm/yyyy or picked from a calendar: the browser's own date box shows mm/dd/yyyy and
 * hides its calendar icon on the dark theme. Thai shows the Buddhist year; the value is always YYYY-MM-DD.
 */
export function DatePicker({ value, onChange, className, name }: DatePickerProps) {
  const { t, i18n } = useTranslation()
  const th = i18n.language === 'th'
  const months = MONTHS[th ? 'th' : 'en']
  const days = DAYS[th ? 'th' : 'en']
  const [text, setText] = useState(() => dayToText(value, th))
  const [bad, setBad] = useState(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const start = value || todayDay()
  const [viewY, setViewY] = useState(+start.slice(0, 4))
  const [viewM, setViewM] = useState(+start.slice(5, 7) - 1)

  // A value set from outside (another field, a saved card) shows here.
  useEffect(() => { setText(dayToText(value, th)); setBad(false) }, [value, th])

  useEffect(() => {
    if (!open || !boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    const H = 330, W = 290
    setPos({ top: window.innerHeight - r.bottom - 8 >= H ? r.bottom + 4 : Math.max(8, r.top - H - 4), left: Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8)) })
    const v = value || todayDay()
    setViewY(+v.slice(0, 4)); setViewM(+v.slice(5, 7) - 1)
    const close = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const commitText = () => {
    if (!text.trim()) { setBad(false); if (value) onChange(''); return }
    const day = textToDay(text)
    if (day) { setBad(false); onChange(day); setText(dayToText(day, th)) } else setBad(true)
  }
  const pick = (day: string) => { onChange(day); setText(dayToText(day, th)); setBad(false); setOpen(false) }
  const move = (delta: number) => { const d = new Date(viewY, viewM + delta, 1); setViewY(d.getFullYear()); setViewM(d.getMonth()) }
  const thisYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = thisYear + 10; y >= 2000; y--) years.push(y)
  if (!years.includes(viewY)) years.push(viewY)
  const first = new Date(viewY, viewM, 1).getDay()
  const count = new Date(viewY, viewM + 1, 0).getDate()
  const today = todayDay()

  return (
    <>
      <div ref={boxRef} className={`flex items-center w-full bg-slate-950 border rounded-lg focus-within:border-cyan-500 ${bad ? 'border-rose-500' : 'border-slate-700'} ${className ?? ''}`}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText() } }}
          placeholder={th ? 'วว/ดด/ปปปป (พ.ศ.)' : 'dd/mm/yyyy'}
          inputMode="numeric"
          className="flex-1 min-w-0 bg-transparent h-[38px] px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none"
          data-date={name}
          title={bad ? t('ui.datePicker.invalid') : undefined}
        />
        {value && (
          <button type="button" onClick={() => { onChange(''); setText('') }} className="p-1 text-slate-500 hover:text-white" title={t('ui.datePicker.clear')}><X size={13} /></button>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} className="px-2.5 h-[38px] text-cyan-400 hover:text-cyan-300 border-l border-slate-700" title={t('ui.datePicker.open')} data-date-open={name}>
          <CalendarDays size={16} />
        </button>
      </div>
      {bad && <p className="mt-1 text-[11px] text-rose-400">{t('ui.datePicker.invalid')}</p>}

      {open && createPortal(
        <div ref={popRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 99999, width: 290 }}
          className="bg-slate-900 border border-white/20 rounded-xl shadow-2xl p-3 text-sm" data-date-popup={name}>
          <div className="flex items-center gap-1 mb-2">
            <button type="button" onClick={() => move(-1)} className="p-1 hover:bg-white/10 rounded text-white"><ChevronLeft size={14} /></button>
            <select value={viewM} onChange={(e) => setViewM(+e.target.value)} className="flex-1 bg-slate-800 border border-white/10 rounded px-1 py-1 text-white text-xs">
              {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select value={viewY} onChange={(e) => setViewY(+e.target.value)} className="w-20 bg-slate-800 border border-white/10 rounded px-1 py-1 text-white text-xs" data-date-year>
              {years.sort((a, b) => b - a).map((y) => <option key={y} value={y}>{th ? y + 543 : y}</option>)}
            </select>
            <button type="button" onClick={() => move(1)} className="p-1 hover:bg-white/10 rounded text-white"><ChevronRight size={14} /></button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {days.map((d) => <div key={d} className="text-center text-[11px] text-gray-400 py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: first }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: count }).map((_, i) => {
              const day = `${viewY}-${pad(viewM + 1)}-${pad(i + 1)}`
              const sel = day === value
              return (
                <button type="button" key={day} onClick={() => pick(day)} data-day={day}
                  className={`py-1.5 text-xs rounded-lg ${sel ? 'bg-cyan-500 text-white font-bold' : day === today ? 'border border-cyan-500/50 text-cyan-400' : 'text-white hover:bg-white/10'}`}>
                  {i + 1}
                </button>
              )
            })}
          </div>
          <div className="mt-2 pt-2 border-t border-white/10 flex justify-between">
            <button type="button" onClick={() => pick(today)} className="text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 px-2 py-1 rounded">{t('ui.datePicker.today')}</button>
            {value && <button type="button" onClick={() => { onChange(''); setText(''); setOpen(false) }} className="text-xs text-slate-300 hover:text-white px-2 py-1">{t('ui.datePicker.clear')}</button>}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
