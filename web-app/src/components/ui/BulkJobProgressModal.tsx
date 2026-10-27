import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from './Modal'
import { imageServiceApi } from '../../services/imageServiceApi'

export interface BulkJobState {
  id: string
  kind: string
  status: 'running' | 'completed' | 'failed'
  total: number
  done: number
  deletedBytes: number
  errors: number
  errorMessage?: string
  result?: Record<string, unknown>
}

interface BulkJobProgressModalProps {
  /** null stops polling entirely. Pass a jobId returned by a bulk-delete/trash-purge call to start tracking it. */
  jobId: string | null
  /**
   * Controls only whether the modal is visually shown — independent of `jobId`. Set to
   * false to let the user "close" the dialog while a job is still running: polling (and
   * the onDone toast when it finishes) keeps going as long as `jobId` stays set, it just
   * renders nothing until `visible` is true again or the job finishes.
   */
  visible: boolean
  title: React.ReactNode
  onClose: () => void
  /** Fires once, when the job reaches 'completed' or 'failed' (not on every poll tick) — even if `visible` is false at the time. */
  onDone?: (job: BulkJobState) => void
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

// Polls a background bulk-delete/trash-purge job (see image-api lib/bulk-job.ts) and
// renders its progress. These operations run server-side independent of this component —
// closing the modal early does not cancel or pause anything, it only stops polling.
export function BulkJobProgressModal({ jobId, visible, title, onClose, onDone }: BulkJobProgressModalProps) {
  const { t } = useTranslation()
  const [job, setJob] = useState<BulkJobState | null>(null)
  const doneCalledRef = useRef(false)

  useEffect(() => {
    if (!jobId) {
      setJob(null)
      doneCalledRef.current = false
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      try {
        const data: BulkJobState = await imageServiceApi.getBulkJobStatus(jobId)
        if (cancelled) return
        setJob(data)
        if (data.status === 'running') {
          timer = setTimeout(poll, 1000)
        } else if (!doneCalledRef.current) {
          doneCalledRef.current = true
          onDone?.(data)
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 2000)
      }
    }
    poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  if (!jobId) return null

  const total = job?.total ?? 0
  const done = job?.done ?? 0
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : (job && job.status !== 'running' ? 100 : 0)
  const isRunning = !job || job.status === 'running'
  const isFailed = job?.status === 'failed'

  return (
    <Modal isOpen={visible} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm text-gray-300 mb-1">
            <span>
              {isRunning
                ? t('imageService.search.bulkJobRunning', 'กำลังลบ...')
                : isFailed
                  ? t('imageService.search.bulkJobFailed', 'เกิดข้อผิดพลาด')
                  : t('imageService.search.bulkJobCompleted', 'เสร็จสิ้น')}
            </span>
            <span>{done.toLocaleString()} / {total.toLocaleString()} ({percent}%)</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${isFailed ? 'bg-red-500' : isRunning ? 'bg-blue-500' : 'bg-green-500'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md bg-white/5 p-2.5">
            <div className="text-gray-400">{t('imageService.search.bulkJobFreed', 'พื้นที่ที่คืนแล้ว')}</div>
            <div className="text-white font-medium">{formatBytes(job?.deletedBytes ?? 0)}</div>
          </div>
          <div className="rounded-md bg-white/5 p-2.5">
            <div className="text-gray-400">{t('imageService.search.bulkJobErrors', 'ผิดพลาด')}</div>
            <div className={`font-medium ${(job?.errors ?? 0) > 0 ? 'text-amber-400' : 'text-white'}`}>{job?.errors ?? 0}</div>
          </div>
        </div>

        {isFailed && job?.errorMessage && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-2.5">
            {job.errorMessage}
          </div>
        )}

        {!isRunning && (job?.errors ?? 0) > 0 && (
          <p className="text-xs text-amber-400">
            {t('imageService.search.bulkJobErrorsHint', 'ไฟล์ที่ลบไม่สำเร็จจะถูกเก็บไว้ ลองใหม่ได้อีกครั้งภายหลัง')}
          </p>
        )}

        {isRunning ? (
          <p className="text-xs text-gray-500 text-center">
            {t('imageService.search.bulkJobKeepOpen', 'ทำงานอยู่เบื้องหลัง ปิดหน้าต่างนี้ได้ เสร็จแล้วจะแจ้งเตือนให้ (ถ้ายังอยู่หน้านี้)')}
          </p>
        ) : (
          <button
            onClick={onClose}
            className="w-full py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            {t('common.close', 'ปิด')}
          </button>
        )}
      </div>
    </Modal>
  )
}
