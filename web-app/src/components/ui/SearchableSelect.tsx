import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Search } from 'lucide-react'

interface Option {
  value: string
  label: string
}

interface SearchableSelectProps {
  value?: string
  onChange?: (value: string) => void

  isMulti?: boolean
  selectedValues?: string[]
  onMultiChange?: (values: string[]) => void

  options: Option[]
  placeholder?: string
  showSearch?: boolean
}

export function SearchableSelect({
  value,
  onChange,
  isMulti = false,
  selectedValues = [],
  onMultiChange,
  options,
  placeholder,
  showSearch = true
}: SearchableSelectProps) {
  const { t } = useTranslation()
  const resolvedPlaceholder = placeholder ?? t('common.select', 'Select...')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; width: number; openUp: boolean } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element
      if (containerRef.current && !containerRef.current.contains(target) &&
          !target.closest?.('[data-searchable-dropdown]')) {
        setOpen(false)
      }
    }
    const handleScroll = () => setOpen(false)
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const isSelected = (val: string) => {
    if (isMulti) {
      return selectedValues.includes(val)
    }
    return value === val
  }

  const getDisplayText = () => {
    if (isMulti) {
      const activeOptions = options.filter(o => selectedValues.includes(o.value))
      if (activeOptions.length === 0) return resolvedPlaceholder
      if (activeOptions.length <= 2) return activeOptions.map(o => o.label).join(', ')
      return t('common.itemsSelected', { count: activeOptions.length, defaultValue: `${activeOptions.length} items selected` })
    } else {
      const sel = options.find(o => o.value === value)
      return sel ? sel.label : resolvedPlaceholder
    }
  }

  const handleOptionClick = (optValue: string) => {
    if (isMulti) {
      const current = [...selectedValues]
      if (current.includes(optValue)) {
        const updated = current.filter(v => v !== optValue)
        onMultiChange?.(updated)
      } else {
        onMultiChange?.([...current, optValue])
      }
    } else {
      onChange?.(optValue)
      setOpen(false)
      setCoords(null)
    }
  }

  const handleToggle = () => {
    if (!open) {
      const rect = btnRef.current!.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const dropdownHeight = 260

      if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
        setCoords({
          bottom: window.innerHeight - rect.top + 4,
          left: rect.left,
          width: rect.width,
          openUp: true
        })
      } else {
        setCoords({
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          openUp: false
        })
      }
    }
    setOpen(!open)
    if (open) setCoords(null)
    setQuery('')
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm border border-white/30 bg-white/10 backdrop-blur-md text-white"
      >
        <span className={(isMulti ? selectedValues.length > 0 : value) ? 'text-white' : 'text-gray-400'}>
          {getDisplayText()}
        </span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && coords && createPortal(
        <div
          data-searchable-dropdown
          style={{
            position: 'fixed',
            ...(coords.openUp ? { bottom: coords.bottom } : { top: coords.top }),
            left: coords.left,
            width: coords.width,
            zIndex: 99999
          }}
          className="rounded-md border border-white/20 bg-slate-800 shadow-xl max-h-60 overflow-y-auto"
        >
          {showSearch && (
            <div className="sticky top-0 bg-slate-800 p-1 border-b border-white/10">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full pl-8 pr-2 py-1.5 rounded text-xs bg-white/10 border border-white/20 text-white placeholder-gray-400"
                  placeholder={`${t('common.search', 'Search')}...`}
                />
              </div>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">{t('common.noData', 'No results')}</div>
          ) : (
            filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => handleOptionClick(o.value)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                  isSelected(o.value) ? 'bg-cyan-500/20 text-cyan-300' : 'text-white hover:bg-white/10'
                }`}
              >
                {isMulti && (
                  <input
                    type="checkbox"
                    checked={isSelected(o.value)}
                    readOnly
                    className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50 bg-white/10 cursor-pointer w-3.5 h-3.5"
                  />
                )}
                <span>{o.label}</span>
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
