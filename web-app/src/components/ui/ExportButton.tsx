import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'

export interface ExportSection {
  title: string;
  columns: { key: string; label: string }[];
  data: any[];
}

export interface ExportButtonProps {
  filename: string;
  title?: string;
  sections: ExportSection[];
  targetRef?: React.RefObject<HTMLElement>;
}

function exportExcel(sections: ExportSection[], filename: string) {
  import('xlsx').then((XLSX) => {
    const wb = XLSX.utils.book_new()
    const allRows: any[][] = []

    for (let si = 0; si < sections.length; si++) {
      const section = sections[si]
      if (si > 0) allRows.push([])
      allRows.push([section.title])
      allRows.push(section.columns.map(c => c.label))
      if (section.data.length > 0) {
        for (const row of section.data) {
          allRows.push(section.columns.map(c => {
            const v = row[c.key]
            return v === null || v === undefined ? '' : v
          }))
        }
      } else {
        allRows.push(section.columns.map(() => '-'))
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(allRows)
    const maxCols = Math.max(...allRows.map(r => r.length))
    ws['!cols'] = Array.from({ length: maxCols }, () => ({ wch: 25 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Report')
    XLSX.writeFile(wb, `${filename}.xlsx`)
  })
}

async function loadFont(): Promise<string> {
  const res = await fetch('/fonts/Sarabun-Regular.ttf')
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function loadFontBold(): Promise<string> {
  const res = await fetch('/fonts/Sarabun-Bold.ttf')
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function exportPDF(sections: ExportSection[], filename: string, title: string) {
  const { default: jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const [fontBase64, fontBoldBase64] = await Promise.all([loadFont(), loadFontBold()])

  const pdf = new jsPDF('landscape', 'mm', 'a4')
  pdf.addFileToVFS('Sarabun-Regular.ttf', fontBase64)
  pdf.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal')
  pdf.addFileToVFS('Sarabun-Bold.ttf', fontBoldBase64)
  pdf.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold')
  pdf.setFont('Sarabun', 'normal')

  const pageWidth = pdf.internal.pageSize.getWidth()

  pdf.setFont('Sarabun', 'bold')
  pdf.setFontSize(16)
  pdf.setTextColor(40, 40, 40)
  pdf.text(title, pageWidth / 2, 15, { align: 'center' })
  pdf.setFont('Sarabun', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(120, 120, 120)
  pdf.text(new Date().toLocaleString(), pageWidth / 2, 21, { align: 'center' })

  let startY = 28

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si]

    if (si > 0) {
      const lastTable = (pdf as any).lastAutoTable
      startY = (lastTable?.finalY ?? startY) + 10
      if (startY > pdf.internal.pageSize.getHeight() - 30) {
        pdf.addPage()
        startY = 15
      }
    }

    pdf.setFont('Sarabun', 'bold')
    pdf.setFontSize(12)
    pdf.setTextColor(40, 40, 40)
    pdf.text(section.title, 14, startY)
    startY += 6

    const head = [section.columns.map(c => c.label)]
    const body = section.data.map(row =>
      section.columns.map(c => {
        const v = row[c.key]
        return v === null || v === undefined ? '-' : String(v)
      })
    )

    autoTable(pdf, {
      startY,
      head,
      body: body.length > 0 ? body : [section.columns.map(() => '-')],
      styles: { fontSize: 9, cellPadding: 3, font: 'Sarabun' },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold', font: 'Sarabun' },
      bodyStyles: { font: 'Sarabun' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 14, right: 14 },
    })
  }

  pdf.save(`${filename}.pdf`)
}

export function ExportButton({ filename, title, sections }: ExportButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
  }, [open])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const hasData = sections.some(s => s.data.length > 0)

  const handleExport = async (type: 'excel' | 'pdf') => {
    setExporting(true)
    setOpen(false)
    try {
      if (type === 'excel') exportExcel(sections, filename)
      else await exportPDF(sections, filename, title || filename)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  if (!hasData) return null

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(!open)} disabled={exporting}
        className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors disabled:opacity-50">
        {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        {exporting ? t('common.exporting') : t('common.export')}
      </button>
      {open && createPortal(
        <div ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 99999 }}
          className="w-48 rounded-lg bg-slate-800 border border-white/20 shadow-2xl overflow-hidden">
          <button onClick={() => handleExport('excel')}
            className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 text-white/90 hover:bg-white/10 transition-colors">
            <FileSpreadsheet size={14} className="text-green-400" />
            {t('common.exportExcel')}
          </button>
          <button onClick={() => handleExport('pdf')}
            className="w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 text-white/90 hover:bg-white/10 transition-colors">
            <FileText size={14} className="text-red-400" />
            {t('common.exportPdf')}
          </button>
        </div>,
        document.body
      )}
    </>
  )
}
