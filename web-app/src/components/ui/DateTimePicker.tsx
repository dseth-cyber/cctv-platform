import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Clock, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/contexts/ThemeContext'
import { toDatetimeLocal } from '@/utils/dateUtils'

interface DateTimePickerProps {
  value: string // ISO datetime-local format YYYY-MM-DDTHH:mm
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

const MONTH_NAMES_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES_TH = ['อา','จ','อ','พ','พฤ','ศ','ส']
const DAY_NAMES_EN = ['Su','Mo','Tu','We','Th','Fr','Sa']

export function DateTimePicker({ value, onChange, placeholder, className }: DateTimePickerProps) {
  const { i18n } = useTranslation()
  const { themeConfig } = useTheme()
  const isTH = i18n.language === 'th'
  const MONTH_NAMES = isTH ? MONTH_NAMES_TH : MONTH_NAMES_EN
  const DAY_NAMES = isTH ? DAY_NAMES_TH : DAY_NAMES_EN

  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const parsed = value ? new Date(value) : null
  const [viewYear, setViewYear] = useState(() => parsed ? parsed.getFullYear() : new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => parsed ? parsed.getMonth() : new Date().getMonth())
  const [selDate, setSelDate] = useState<Date | null>(parsed)
  const [timeH, setTimeH] = useState(() => parsed ? String(parsed.getHours()).padStart(2,'0') : '08')
  const [timeM, setTimeM] = useState(() => parsed ? String(parsed.getMinutes()).padStart(2,'0') : '00')

  useEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const PICKER_H = 320
      const PICKER_W = 300
      const spaceBelow = window.innerHeight - r.bottom - 8
      const top = spaceBelow >= PICKER_H ? r.bottom + 4 : r.top - PICKER_H - 4
      const left = Math.min(r.left, window.innerWidth - PICKER_W - 8)
      setPos({ top, left })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const commit = (d: Date | null, h: string, m: string) => {
    if (!d) { onChange(''); return }
    const nd = new Date(d)
    nd.setHours(parseInt(h) || 0, parseInt(m) || 0, 0, 0)
    onChange(toDatetimeLocal(nd))
  }

  const setNow = () => {
    const now = new Date()
    setSelDate(now)
    setViewYear(now.getFullYear())
    setViewMonth(now.getMonth())
    setTimeH(String(now.getHours()).padStart(2,'0'))
    setTimeM(String(now.getMinutes()).padStart(2,'0'))
    commit(now, String(now.getHours()).padStart(2,'0'), String(now.getMinutes()).padStart(2,'0'))
    setOpen(false)
  }

  const clear = () => { setSelDate(null); onChange('') }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const displayYear = isTH ? viewYear + 543 : viewYear

  const displayValue = () => {
    if (!selDate) return ''
    const d = new Date(selDate)
    d.setHours(parseInt(timeH)||0, parseInt(timeM)||0)
    const y = isTH ? d.getFullYear() + 543 : d.getFullYear()
    const mo = String(d.getMonth()+1).padStart(2,'0')
    const da = String(d.getDate()).padStart(2,'0')
    return `${da}/${mo}/${y}  ${timeH}:${timeM}`
  }

  return (
    <>
      <button type="button" ref={btnRef} onClick={() => setOpen(!open)}
        className={`w-full px-3 py-2 rounded-md text-sm text-left flex items-center justify-between border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} ${className ?? ''}`}>
        <span className={selDate ? themeConfig.text.primary : themeConfig.text.secondary}>
          {displayValue() || placeholder || 'วว/ดด/ปปปป  ชม:นน'}
        </span>
        <div className="flex items-center gap-1">
          {selDate && (
            <span onClick={e => { e.stopPropagation(); clear() }} className="text-gray-400 hover:text-white p-0.5">
              <X size={12} />
            </span>
          )}
          <Clock size={13} className="text-gray-400" />
        </div>
      </button>

      {open && createPortal(
        <div ref={pickerRef} style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 99999, width: 300 }}
          className="bg-slate-900 border border-white/20 rounded-xl shadow-2xl p-4 text-sm">

          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={() => { const d = new Date(viewYear, viewMonth - 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()) }}
              className="p-1 hover:bg-white/10 rounded"><ChevronLeft size={14} /></button>
            <span className="font-semibold text-white">{MONTH_NAMES[viewMonth]} {displayYear}</span>
            <button type="button" onClick={() => { const d = new Date(viewYear, viewMonth + 1); setViewYear(d.getFullYear()); setViewMonth(d.getMonth()) }}
              className="p-1 hover:bg-white/10 rounded"><ChevronRight size={14} /></button>
          </div>

          {/* Day names */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-center text-xs text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const isToday = new Date().toDateString() === new Date(viewYear, viewMonth, day).toDateString()
              const isSel = selDate && selDate.getFullYear() === viewYear && selDate.getMonth() === viewMonth && selDate.getDate() === day
              return (
                <button type="button" key={day}
                  onClick={() => {
                    const nd = new Date(viewYear, viewMonth, day)
                    setSelDate(nd)
                    commit(nd, timeH, timeM)
                  }}
                  className={`text-center py-1.5 text-xs rounded-lg transition-colors ${
                    isSel ? 'bg-cyan-500 text-white font-bold' :
                    isToday ? 'border border-cyan-500/50 text-cyan-400' :
                    'text-white hover:bg-white/10'}`}>
                  {day}
                </button>
              )
            })}
          </div>

          {/* Time */}
          <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
            <Clock size={14} className="text-gray-400 flex-shrink-0" />
            <input type="number" min="0" max="23" value={timeH}
              onChange={e => { const v = String(Math.max(0, Math.min(23, parseInt(e.target.value)||0))).padStart(2,'0'); setTimeH(v); if (selDate) commit(selDate, v, timeM) }}
              className="w-12 text-center bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm" />
            <span className="text-white font-bold">:</span>
            <input type="number" min="0" max="59" value={timeM}
              onChange={e => { const v = String(Math.max(0, Math.min(59, parseInt(e.target.value)||0))).padStart(2,'0'); setTimeM(v); if (selDate) commit(selDate, timeH, v) }}
              className="w-12 text-center bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm" />
            <button type="button" onClick={setNow}
              className="ml-auto text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 px-2 py-1 rounded">
              ตอนนี้
            </button>
            {selDate && (
              <button type="button" onClick={() => setOpen(false)}
                className="text-xs text-white bg-cyan-600 hover:bg-cyan-500 px-2 py-1 rounded">
                ✓
              </button>
            )}
          </div>

        </div>,
        document.body
      )}
    </>
  )
}
