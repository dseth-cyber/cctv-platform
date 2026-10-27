import { useTranslation } from 'react-i18next'
import { useTheme } from '@/contexts/ThemeContext'
import { Camera, RefreshCw, Database, HardDrive, Server, Cpu } from 'lucide-react'

export interface PipelineProps {
  cameras: { active: number; total: number; error: number }
  syncWorker: { ok: boolean; lastPoll?: string }
  queue: { wait: number; active: number; failed: number }
  processingWorker: { ok: boolean; running: number }
  storage: { ok: boolean; providers: Array<{ name: string; ok: boolean; latencyMs: number }> }
  database: { ok: boolean }
}

type NodeStatus = 'ok' | 'degraded' | 'down'

interface PipelineNode {
  id: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  labelKey: string
  status: NodeStatus
  metric: string
}

const statusDot: Record<NodeStatus, string> = {
  ok: 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]',
  degraded: 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]',
  down: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]',
}

const statusGlow: Record<NodeStatus, string> = {
  ok: 'border-green-500/30',
  degraded: 'border-yellow-500/30',
  down: 'border-red-500/30',
}

function getLineColor(nextStatus: NodeStatus): string {
  if (nextStatus === 'down') return '#ef4444'
  if (nextStatus === 'degraded') return '#facc15'
  return '#22d3ee'
}

export default function PipelineFlow({ cameras, syncWorker, queue, processingWorker, storage, database }: PipelineProps) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()

  const cameraStatus: NodeStatus = cameras.error > 0 ? 'degraded' : cameras.active > 0 ? 'ok' : 'down'
  const syncStatus: NodeStatus = syncWorker.ok ? 'ok' : 'down'
  const queueStatus: NodeStatus = queue.failed > 0 ? 'degraded' : 'ok'
  const procStatus: NodeStatus = processingWorker.ok ? 'ok' : 'down'
  const storageStatus: NodeStatus = storage.ok ? (storage.providers.some(p => !p.ok) ? 'degraded' : 'ok') : 'down'
  const dbStatus: NodeStatus = database.ok ? 'ok' : 'down'

  const avgLatency = storage.providers.length > 0
    ? Math.round(storage.providers.reduce((s, p) => s + p.latencyMs, 0) / storage.providers.length)
    : 0

  const nodes: PipelineNode[] = [
    {
      id: 'camera',
      icon: Camera,
      labelKey: 'imageService.health.pipelineCamera',
      status: cameraStatus,
      metric: `${cameras.active}/${cameras.total} active`,
    },
    {
      id: 'sync',
      icon: RefreshCw,
      labelKey: 'imageService.health.pipelineSyncWorker',
      status: syncStatus,
      metric: syncWorker.lastPoll ? new Date(syncWorker.lastPoll).toLocaleTimeString() : '--',
    },
    {
      id: 'queue',
      icon: Server,
      labelKey: 'imageService.health.pipelineRedisQueue',
      status: queueStatus,
      metric: `${queue.wait} wait / ${queue.active} active`,
    },
    {
      id: 'processing',
      icon: Cpu,
      labelKey: 'imageService.health.pipelineProcessingWorker',
      status: procStatus,
      metric: `${processingWorker.running} running`,
    },
    {
      id: 'storage',
      icon: HardDrive,
      labelKey: 'imageService.health.pipelineStorage',
      status: storageStatus,
      metric: `${avgLatency}ms latency`,
    },
    {
      id: 'database',
      icon: Database,
      labelKey: 'imageService.health.pipelineDatabase',
      status: dbStatus,
      metric: dbStatus === 'ok' ? 'connected' : 'offline',
    },
  ]

  return (
    <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
      <div className="flex items-center gap-2 mb-5">
        <div className="p-2 rounded-lg bg-cyan-500/10">
          <Server size={20} className="text-cyan-400" />
        </div>
        <div>
          <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>
            {t('imageService.health.pipeline')}
          </h3>
          <p className={`text-xs ${themeConfig.text.secondary}`}>
            Camera &rarr; Sync Worker &rarr; Redis Queue &rarr; Processing Worker &rarr; Storage &rarr; Database
          </p>
        </div>
      </div>

      {/* Desktop: horizontal flow */}
      <div className="hidden md:flex items-center justify-between gap-0">
        {nodes.map((node, idx) => (
          <div key={node.id} className="flex items-center flex-1 min-w-0">
            {/* Node card */}
            <div
              className={`
                relative flex flex-col items-center gap-2 px-4 py-4 rounded-xl border-2
                bg-white/5 backdrop-blur-sm min-w-[120px] w-full
                transition-all duration-300 hover:bg-white/10
                ${statusGlow[node.status]}
              `}
            >
              {/* Status dot */}
              <div className={`absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full ${statusDot[node.status]}`} />

              <node.icon
                size={22}
                className={
                  node.status === 'ok' ? 'text-cyan-400' :
                  node.status === 'degraded' ? 'text-yellow-400' :
                  'text-red-400'
                }
              />

              <span className={`text-xs font-semibold text-center leading-tight ${themeConfig.text.primary}`}>
                {t(node.labelKey)}
              </span>

              <span
                className={`text-[10px] font-mono text-center leading-tight ${
                  node.status === 'ok' ? 'text-green-400' :
                  node.status === 'degraded' ? 'text-yellow-400' :
                  'text-red-400'
                }`}
              >
                {node.metric}
              </span>
            </div>

            {/* Connecting line (not after last node) */}
            {idx < nodes.length - 1 && (
              <div className="flex-shrink-0 w-8 h-[2px] relative overflow-hidden mx-1">
                <div
                  className="absolute inset-0"
                  style={{ backgroundColor: `${getLineColor(nodes[idx + 1].status)}33` }}
                />
                <div
                  className="absolute inset-y-0 w-4 pipeline-flow-dot"
                  style={{ backgroundColor: getLineColor(nodes[idx + 1].status) }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Mobile: vertical flow */}
      <div className="flex md:hidden flex-col items-center gap-0">
        {nodes.map((node, idx) => (
          <div key={node.id} className="flex flex-col items-center w-full">
            {/* Node card */}
            <div
              className={`
                relative flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2
                bg-white/5 backdrop-blur-sm
                transition-all duration-300
                ${statusGlow[node.status]}
              `}
            >
              {/* Status dot */}
              <div className={`absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full ${statusDot[node.status]}`} />

              <node.icon
                size={20}
                className={
                  node.status === 'ok' ? 'text-cyan-400' :
                  node.status === 'degraded' ? 'text-yellow-400' :
                  'text-red-400'
                }
              />

              <div className="flex-1 min-w-0">
                <span className={`text-xs font-semibold ${themeConfig.text.primary}`}>
                  {t(node.labelKey)}
                </span>
                <p
                  className={`text-[10px] font-mono truncate ${
                    node.status === 'ok' ? 'text-green-400' :
                    node.status === 'degraded' ? 'text-yellow-400' :
                    'text-red-400'
                  }`}
                >
                  {node.metric}
                </p>
              </div>
            </div>

            {/* Vertical connecting line */}
            {idx < nodes.length - 1 && (
              <div className="w-[2px] h-5 relative overflow-hidden">
                <div
                  className="absolute inset-0"
                  style={{ backgroundColor: `${getLineColor(nodes[idx + 1].status)}33` }}
                />
                <div
                  className="absolute inset-x-0 h-3 pipeline-flow-dot-v"
                  style={{ backgroundColor: getLineColor(nodes[idx + 1].status) }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* CSS keyframes for flowing dot animation */}
      <style>{`
        @keyframes pipelineFlowH {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes pipelineFlowV {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(200%); }
        }
        .pipeline-flow-dot {
          animation: pipelineFlowH 1.2s ease-in-out infinite;
          border-radius: 1px;
        }
        .pipeline-flow-dot-v {
          animation: pipelineFlowV 1.2s ease-in-out infinite;
          border-radius: 1px;
        }
      `}</style>
    </div>
  )
}
