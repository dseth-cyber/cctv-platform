import { useMemo, useState, Fragment } from 'react'
import { Search, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

import { useTranslation } from 'react-i18next'
export interface EbookPage {
  id: string
  title: string
  icon?: React.ComponentType<{ size?: number; className?: string }>
  /** Plain text body. Supports blank-line paragraph breaks and "• " bullet lines. */
  body: string
}

function highlight(text: string, query: string) {
  if (!query.trim()) return text
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.trim().toLowerCase() ? (
      <mark key={i} className="bg-cyan-400/40 text-inherit rounded px-0.5">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  )
}

export function EbookReader({
  pages,
  pageIndex,
  onPageChange,
}: {
  pages: EbookPage[]
  pageIndex: number
  onPageChange: (index: number) => void
}) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const [query, setQuery] = useState('')
  const [pageInput, setPageInput] = useState(String(pageIndex + 1))

  // Keep input in sync with external pageIndex state
  useMemo(() => {
    setPageInput(String(pageIndex + 1))
  }, [pageIndex])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return pages
      .map((page, index) => ({ index, page }))
      .filter(({ page }) => page.title.toLowerCase().includes(q) || page.body.toLowerCase().includes(q))
  }, [pages, query])

  const isSearching = query.trim().length > 0
  const current = pages[pageIndex]
  const goTo = (index: number) => {
    const valid = Math.max(0, Math.min(pages.length - 1, index))
    onPageChange(valid)
    setPageInput(String(valid + 1))
  }

  const handlePageCommit = () => {
    const parsed = parseInt(pageInput, 10)
    if (!isNaN(parsed)) {
      goTo(parsed - 1)
    } else {
      setPageInput(String(pageIndex + 1))
    }
  }

  const paginationControls = (
    <div className="flex items-center justify-between">
      <button
        onClick={() => goTo(pageIndex - 1)}
        disabled={pageIndex === 0}
        className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        <ChevronLeft size={14} />
        {t('common.prev')}
      </button>
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <span>{t('common.page')}</span>
        <input
          type="number"
          min={1}
          max={pages.length}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handlePageCommit()
              e.currentTarget.blur()
            }
          }}
          onBlur={handlePageCommit}
          className="w-12 px-1.5 py-0.5 rounded border border-white/15 bg-white/5 text-center text-xs font-semibold text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
          title={t('ui.ebookReader.typePageNumberAndPressEnter')}
        />
        <span>of {pages.length}</span>
      </div>
      <button
        onClick={() => goTo(pageIndex + 1)}
        disabled={pageIndex === pages.length - 1}
        className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-cyan-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
      >
        {t('common.next')}
        <ChevronRight size={14} />
      </button>
    </div>
  )

  return (
    <div>
      {/* Search bar */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('ui.ebookReader.searchThisGuide')}
          className="w-full pl-9 pr-9 py-2 rounded-md bg-white/5 border border-white/10 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500/50 placeholder:text-gray-500"
        />
        {isSearching && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Search results list */}
      {isSearching && (
        <div className="mb-4 rounded-md border border-white/10 divide-y divide-white/5 overflow-hidden">
          {matches.length === 0 ? (
            <div className="p-3 text-xs text-gray-500">{t('ui.ebookReader.noPagesMatch')}{query}"</div>
          ) : (
            matches.map(({ index, page }) => (
              <button
                key={page.id}
                onClick={() => {
                  goTo(index)
                  setQuery('')
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors flex items-center justify-between gap-2"
              >
                <span>{highlight(page.title, query)}</span>
                <span className="text-gray-500 shrink-0">{t('common.page')}{' '}{index + 1}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Current page content */}
      {current && (
        <div>
          <h3 className="text-md font-semibold mb-3 text-white flex items-center gap-2">
            {current.icon && <current.icon size={16} className="text-cyan-400" />}
            {current.title}
          </h3>
          <div className="text-xs text-gray-300 leading-relaxed whitespace-pre-line">
            {highlight(current.body, query)}
          </div>
        </div>
      )}

      {/* Pagination controls (bottom) */}
      <div className="mt-8 pt-4 border-t border-white/5">
        {paginationControls}
      </div>
    </div>
  )
}
