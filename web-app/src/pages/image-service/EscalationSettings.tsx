import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTheme } from '@/contexts/ThemeContext'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/App'
import { imageServiceApi } from '@/services/imageServiceApi'
import { Button, Modal, TableSkeleton, SearchableSelect } from '@/components/ui'
import { TelegramStatusCard } from '@/components/cctv/TelegramStatusCard'
import { Plus, Edit3, Trash2, Users, GitBranch, ListFilter, Eye, Send, Star, ArrowUp, ArrowDown, X, CheckCircle, XCircle, Clock } from 'lucide-react'

/** Escalation (phase 4): who is told about an open alert, in what order and how often. Everything here is set by an admin. */

type Target = { type: 'default' } | { type: 'team'; id: string }
interface Team { id: string; name: string; description: string | null; telegramChatId: string | null; notifyMembers: boolean; enabled: boolean; memberIds: string[]; linkedMemberIds?: string[] }
interface Step { waitMinutes: number; targets: Target[] }
interface Policy { id: string; name: string; description: string | null; repeatMinutes: number; isDefault: boolean; enabled: boolean; steps: Step[]; ruleCount: number }
interface Rule { id: string; alertType: string | null; siteId: string | null; zoneId: string | null; policyId: string; enabled: boolean; policy?: { name: string; enabled: boolean } }

export const ESCALATION_ALERT_TYPES = ['camera_offline', 'hdd_problem', 'recording_stopped', 'clock_drift', 'disk_space', 'storage_warning', 'auth_anomaly', 'incident_escalation'] as const

const inputClass = 'w-full px-3 py-2 rounded-md text-sm border border-white/30 bg-white/10 backdrop-blur-md text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50'
const labelClass = 'block text-sm font-medium text-white mb-1'

const hoursText = (minutes: number, t: (k: string, o?: any) => string) =>
  minutes % 60 === 0 ? t('ui.escalation.hours', { n: minutes / 60 }) : t('ui.escalation.minutes', { n: minutes })

function useErr() {
  const toast = useToast()
  const { t } = useTranslation()
  return (err: any) => { if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error')) }
}

export default function EscalationSettings() {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const { user } = useAuth()
  const canManage = hasPermission(user, 'escalation:manage')
  const [tab, setTab] = useState<'teams' | 'policies' | 'rules' | 'preview'>('teams')

  const tabs = [
    { key: 'teams' as const, icon: Users, label: t('ui.escalation.tabTeams') },
    { key: 'policies' as const, icon: GitBranch, label: t('ui.escalation.tabPolicies') },
    { key: 'rules' as const, icon: ListFilter, label: t('ui.escalation.tabRules') },
    { key: 'preview' as const, icon: Eye, label: t('ui.escalation.tabPreview') },
  ]

  return (
    <div className="p-6">
      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>iSmart CCTV · {t('ui.escalation.title')}</p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('ui.escalation.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>{t('ui.escalation.subtitle')}</p>
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition ${tab === key ? 'bg-cyan-600 border-cyan-400 text-white' : 'border-white/15 text-slate-300 hover:bg-white/5'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === 'teams' && <TeamsTab canManage={canManage} />}
      {tab === 'policies' && <PoliciesTab canManage={canManage} />}
      {tab === 'rules' && <RulesTab canManage={canManage} />}
      {tab === 'preview' && <PreviewTab canManage={canManage} />}
    </div>
  )
}

// ── Teams ────────────────────────────────────────────────────────────────────

function useUsers() {
  return useQuery({
    queryKey: ['escalation-users'],
    queryFn: async () => (await imageServiceApi.getUsers({ limit: 100 }, { silent403: true }))?.data ?? [],
    staleTime: 60_000,
  })
}

function TeamsTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const onErr = useErr()
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Team | 'new' | null>(null)
  const [del, setDel] = useState<Team | null>(null)
  const { data: teams = [], isLoading } = useQuery<Team[]>({ queryKey: ['escalation-teams'], queryFn: imageServiceApi.getEscalationTeams })
  const remove = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteEscalationTeam(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['escalation-teams'] }); toast.success(t('ui.escalation.deleted')); setDel(null) },
    onError: onErr,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className={`text-sm ${themeConfig.text.secondary}`}>{t('ui.escalation.teamsHint')}</p>
        {canManage && <Button onClick={() => setEdit('new')}><Plus size={16} className="mr-1" />{t('ui.escalation.newTeam')}</Button>}
      </div>
      {isLoading ? <TableSkeleton rows={3} cols={4} /> : !teams.length ? (
        <p className={`py-10 text-center ${themeConfig.text.secondary}`}>{t('ui.escalation.noTeams')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className={themeConfig.tableHeader}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">{t('ui.escalation.teamName')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('ui.escalation.members')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('ui.escalation.telegramGroup')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('ui.escalation.enabled')}</th>
                {canManage && <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className={themeConfig.tableRow}>
              {teams.map((tm) => (
                <tr key={tm.id} className={themeConfig.tableBorder}>
                  <td className="px-4 py-3"><div className="font-medium">{tm.name}</div>{tm.description && <div className={`text-xs ${themeConfig.text.secondary}`}>{tm.description}</div>}</td>
                  <td className="px-4 py-3 text-center">{tm.memberIds.length}
                    {tm.notifyMembers && <span className="block text-xs text-cyan-300">{t('ui.escalation.dmLinked', { n: tm.linkedMemberIds?.length ?? 0 })}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{tm.telegramChatId || <span className="text-amber-300">{t('ui.escalation.noGroup')}</span>}</td>
                  <td className="px-4 py-3 text-center">{tm.enabled ? <CheckCircle size={14} className="inline text-green-400" aria-label={t('ui.escalation.enabled')} /> : <XCircle size={14} className="inline text-red-400" aria-label={t('ui.escalation.disabled')} />}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="secondary" size="sm" onClick={() => setEdit(tm)} title={t('common.edit')}><Edit3 size={14} /></Button>
                        <Button variant="secondary" size="sm" className="!text-red-400 hover:!bg-red-500/20" onClick={() => setDel(tm)} title={t('common.delete')}><Trash2 size={14} /></Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <TeamModal team={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      <Modal isOpen={!!del} onClose={() => setDel(null)} title={t('common.deleteConfirm')}>
        <div className="space-y-4">
          <p className="text-sm text-white">{t('ui.escalation.deleteTeamConfirm', { name: del?.name })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDel(null)}>{t('common.cancel')}</Button>
            <Button className="!bg-red-600 hover:!bg-red-700 text-white" onClick={() => del && remove.mutate(del.id)}>{t('common.delete')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function TeamModal({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const onErr = useErr()
  const qc = useQueryClient()
  const { data: users = [] } = useUsers()
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [chatId, setChatId] = useState(team?.telegramChatId ?? '')
  const [enabled, setEnabled] = useState(team?.enabled ?? true)
  const [notifyMembers, setNotifyMembers] = useState(team?.notifyMembers ?? false)
  const linked = new Set(team?.linkedMemberIds ?? [])
  const [members, setMembers] = useState<string[]>(team?.memberIds ?? [])
  const [filter, setFilter] = useState('')
  const save = useMutation({
    mutationFn: (data: any) => (team ? imageServiceApi.updateEscalationTeam(team.id, data) : imageServiceApi.createEscalationTeam(data)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['escalation-teams'] }); toast.success(t('common.saveSuccess')); onClose() },
    onError: onErr,
  })
  const shown = (users as any[]).filter((u) => !filter || `${u.username} ${u.email}`.toLowerCase().includes(filter.toLowerCase()))
  const chatValid = !chatId.trim() || /^-?\d{5,20}$/.test(chatId.trim())

  return (
    <Modal isOpen onClose={onClose} title={team ? t('ui.escalation.editTeam') : t('ui.escalation.newTeam')} size="2xl">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className={labelClass}>{t('ui.escalation.teamName')}</label><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ui.escalation.teamNamePlaceholder')} /></div>
          <div>
            <label className={labelClass}>{t('ui.escalation.telegramGroup')}</label>
            <input className={inputClass} value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-100…" />
            <p className={`text-xs mt-1 ${chatValid ? 'text-slate-400' : 'text-red-400'}`}>{t('ui.escalation.chatIdHint')}</p>
          </div>
        </div>
        <div><label className={labelClass}>{t('ui.escalation.description')}</label><textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t('ui.escalation.enabled')}</label>
          <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={notifyMembers} onChange={(e) => setNotifyMembers(e.target.checked)} />{t('ui.escalation.notifyMembers')}</label>
        </div>
        <div>
          <label className={labelClass}>{t('ui.escalation.members')} ({members.length})</label>
          <input className={`${inputClass} mb-2`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('common.search')} />
          <div className="max-h-56 overflow-y-auto rounded border border-white/10 divide-y divide-white/5">
            {shown.map((u: any) => (
              <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-white hover:bg-white/5">
                <input type="checkbox" checked={members.includes(u.id)} onChange={(e) => setMembers((m) => (e.target.checked ? [...m, u.id] : m.filter((x) => x !== u.id)))} />
                <span className="font-medium">{u.username}</span><span className="text-xs text-slate-400">{u.role}</span>
                {linked.has(u.id) && <span className="text-xs text-cyan-300">· {t('ui.escalation.telegramLinked')}</span>}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-1">{t('ui.escalation.membersHint')} {t('ui.escalation.linkHowTo')}</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!name.trim() || !chatValid || save.isPending}
            onClick={() => save.mutate({ name: name.trim(), description: description.trim() || null, telegramChatId: chatId.trim() || null, notifyMembers, enabled, memberIds: members })}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Chains ───────────────────────────────────────────────────────────────────

function TargetNames({ targets, teams }: { targets: Target[]; teams: Team[] }) {
  const { t } = useTranslation()
  if (!targets.length) return <span className="text-amber-300">{t('ui.escalation.noTargets')}</span>
  return <>{targets.map((tg) => (tg.type === 'default' ? t('ui.escalation.defaultGroup') : teams.find((x) => x.id === tg.id)?.name ?? '?')).join(', ')}</>
}

function PoliciesTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const onErr = useErr()
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Policy | 'new' | null>(null)
  const [del, setDel] = useState<Policy | null>(null)
  const { data: policies = [], isLoading } = useQuery<Policy[]>({ queryKey: ['escalation-policies'], queryFn: imageServiceApi.getEscalationPolicies })
  const { data: teams = [] } = useQuery<Team[]>({ queryKey: ['escalation-teams'], queryFn: imageServiceApi.getEscalationTeams })
  const remove = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteEscalationPolicy(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['escalation-policies'] }); toast.success(t('ui.escalation.deleted')); setDel(null) },
    onError: onErr,
  })
  const test = useMutation({
    mutationFn: (id: string) => imageServiceApi.testEscalationPolicy(id),
    onSuccess: (r: any) => {
      const sent = (r?.results ?? []).reduce((n: number, x: any) => n + (x.sent ?? 0), 0)
      const chats = (r?.results ?? []).reduce((n: number, x: any) => n + (x.chats ?? 0), 0)
      if (sent === chats && chats > 0) toast.success(t('ui.escalation.testSent', { sent, chats }))
      else toast.error(t('ui.escalation.testPartial', { sent, chats }))
    },
    onError: onErr,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className={`text-sm ${themeConfig.text.secondary}`}>{t('ui.escalation.policiesHint')}</p>
        {canManage && <Button onClick={() => setEdit('new')}><Plus size={16} className="mr-1" />{t('ui.escalation.newPolicy')}</Button>}
      </div>
      {isLoading ? <TableSkeleton rows={3} cols={3} /> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {policies.map((p) => (
            <div key={p.id} className={`rounded-lg border p-4 ${p.enabled ? 'border-white/15 bg-white/[0.03]' : 'border-white/10 bg-white/[0.01] opacity-70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    {p.isDefault && <Star size={14} className="text-amber-400 fill-amber-400" aria-label={t('ui.escalation.default')} />}
                    {p.name}
                    {!p.enabled && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{t('ui.escalation.disabled')}</span>}
                    {p.isDefault && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200">{t('ui.escalation.default')}</span>}
                  </div>
                  {p.description && <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>{p.description}</p>}
                </div>
                {canManage && (
                  <div className="flex gap-1 shrink-0">
                    <Button variant="secondary" size="sm" onClick={() => test.mutate(p.id)} disabled={test.isPending} title={t('ui.escalation.test')}><Send size={14} /></Button>
                    <Button variant="secondary" size="sm" onClick={() => setEdit(p)} title={t('common.edit')}><Edit3 size={14} /></Button>
                    {!p.isDefault && <Button variant="secondary" size="sm" className="!text-red-400 hover:!bg-red-500/20" onClick={() => setDel(p)} title={t('common.delete')}><Trash2 size={14} /></Button>}
                  </div>
                )}
              </div>
              <ol className="mt-3 space-y-1.5">
                {p.steps.map((s, i) => (
                  <li key={i} className="text-sm text-slate-200 flex gap-2">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-cyan-900/70 text-cyan-200 text-xs flex items-center justify-center">{i + 1}</span>
                    <span><TargetNames targets={s.targets} teams={teams} />
                      <span className="text-xs text-slate-400"> · {i < p.steps.length - 1 ? t('ui.escalation.waitThenNext', { wait: hoursText(s.waitMinutes, t) }) : t('ui.escalation.repeatEvery', { wait: hoursText(p.repeatMinutes, t) })}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-slate-500 mt-2">{t('ui.escalation.usedByRules', { n: p.ruleCount })}</p>
            </div>
          ))}
        </div>
      )}
      {edit && <PolicyModal policy={edit === 'new' ? null : edit} teams={teams} onClose={() => setEdit(null)} />}
      <Modal isOpen={!!del} onClose={() => setDel(null)} title={t('common.deleteConfirm')}>
        <div className="space-y-4">
          <p className="text-sm text-white">{t('ui.escalation.deletePolicyConfirm', { name: del?.name, n: del?.ruleCount ?? 0 })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDel(null)}>{t('common.cancel')}</Button>
            <Button className="!bg-red-600 hover:!bg-red-700 text-white" onClick={() => del && remove.mutate(del.id)}>{t('common.delete')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function PolicyModal({ policy, teams, onClose }: { policy: Policy | null; teams: Team[]; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const onErr = useErr()
  const qc = useQueryClient()
  const [name, setName] = useState(policy?.name ?? '')
  const [description, setDescription] = useState(policy?.description ?? '')
  const [repeatHours, setRepeatHours] = useState(String((policy?.repeatMinutes ?? 1440) / 60))
  const [enabled, setEnabled] = useState(policy?.enabled ?? true)
  const [isDefault, setIsDefault] = useState(policy?.isDefault ?? false)
  const [steps, setSteps] = useState<{ waitHours: string; targets: Target[] }[]>(
    (policy?.steps ?? [{ waitMinutes: 1440, targets: [{ type: 'default' }] }]).map((s) => ({ waitHours: String(s.waitMinutes / 60), targets: s.targets })),
  )
  const save = useMutation({
    mutationFn: (data: any) => (policy ? imageServiceApi.updateEscalationPolicy(policy.id, data) : imageServiceApi.createEscalationPolicy(data)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['escalation-policies'] }); toast.success(t('common.saveSuccess')); onClose() },
    onError: onErr,
  })
  const has = (s: { targets: Target[] }, tg: Target) => s.targets.some((x) => x.type === tg.type && (x.type === 'default' || (x as any).id === (tg as any).id))
  const toggle = (i: number, tg: Target) => setSteps((all) => all.map((s, j) => (j !== i ? s : { ...s, targets: has(s, tg) ? s.targets.filter((x) => !(x.type === tg.type && (x.type === 'default' || (x as any).id === (tg as any).id))) : [...s.targets, tg] })))
  const move = (i: number, d: -1 | 1) => setSteps((all) => { const n = [...all]; const j = i + d; if (j < 0 || j >= n.length) return all; [n[i], n[j]] = [n[j], n[i]]; return n })
  const minutes = (h: string) => Math.round(Number(h) * 60)
  const valid = name.trim() && steps.length > 0 && steps.every((s) => minutes(s.waitHours) >= 5) && minutes(repeatHours) >= 15

  return (
    <Modal isOpen onClose={onClose} title={policy ? t('ui.escalation.editPolicy') : t('ui.escalation.newPolicy')} size="3xl">
      <div className="space-y-4 max-h-[72vh] overflow-y-auto px-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className={labelClass}>{t('ui.escalation.policyName')}</label><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className={labelClass}>{t('ui.escalation.repeatHours')}</label><input type="number" min={0.25} step={0.25} className={inputClass} value={repeatHours} onChange={(e) => setRepeatHours(e.target.value)} /></div>
        </div>
        <div><label className={labelClass}>{t('ui.escalation.description')}</label><textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={isDefault} />{t('ui.escalation.enabled')}</label>
          <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={isDefault} onChange={(e) => { setIsDefault(e.target.checked); if (e.target.checked) setEnabled(true) }} />{t('ui.escalation.makeDefault')}</label>
        </div>
        <div>
          <label className={labelClass}>{t('ui.escalation.steps')}</label>
          <div className="space-y-3">
            {steps.map((s, i) => (
              <div key={i} className="rounded-lg border border-white/15 p-3 bg-white/[0.03]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-cyan-200">{t('ui.escalation.stepN', { n: i + 1 })}</span>
                  <div className="flex gap-1">
                    <Button variant="secondary" size="sm" onClick={() => move(i, -1)} disabled={i === 0} title={t('ui.escalation.moveUp')}><ArrowUp size={13} /></Button>
                    <Button variant="secondary" size="sm" onClick={() => move(i, 1)} disabled={i === steps.length - 1} title={t('ui.escalation.moveDown')}><ArrowDown size={13} /></Button>
                    <Button variant="secondary" size="sm" onClick={() => setSteps((all) => all.filter((_, j) => j !== i))} disabled={steps.length === 1} title={t('common.delete')}><X size={13} /></Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-2">
                  <label className="flex items-center gap-1.5 text-sm text-white"><input type="checkbox" checked={has(s, { type: 'default' })} onChange={() => toggle(i, { type: 'default' })} />{t('ui.escalation.defaultGroup')}</label>
                  {teams.map((tm) => (
                    <label key={tm.id} className="flex items-center gap-1.5 text-sm text-white"><input type="checkbox" checked={has(s, { type: 'team', id: tm.id })} onChange={() => toggle(i, { type: 'team', id: tm.id })} />{tm.name}{!tm.telegramChatId && <span className="text-xs text-amber-300">({t('ui.escalation.noGroup')})</span>}</label>
                  ))}
                </div>
                {i < steps.length - 1 ? (
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <Clock size={14} />{t('ui.escalation.waitLabel')}
                    <input type="number" min={0.1} step={0.5} className={`${inputClass} !w-24`} value={s.waitHours} onChange={(e) => setSteps((all) => all.map((x, j) => (j === i ? { ...x, waitHours: e.target.value } : x)))} />
                    {t('ui.escalation.hoursUnit')}
                  </div>
                ) : <p className="text-xs text-slate-400">{t('ui.escalation.lastStepRepeats')}</p>}
              </div>
            ))}
          </div>
          {steps.length < 10 && (
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => setSteps((all) => [...all, { waitHours: '24', targets: [] }])}><Plus size={14} className="mr-1" />{t('ui.escalation.addStep')}</Button>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate({
            name: name.trim(), description: description.trim() || null, repeatMinutes: minutes(repeatHours), enabled, isDefault,
            steps: steps.map((s, i) => ({ waitMinutes: i < steps.length - 1 ? minutes(s.waitHours) : Math.max(5, minutes(s.waitHours) || 1440), targets: s.targets })),
          })}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Rules ────────────────────────────────────────────────────────────────────

function useSites() {
  return useQuery({ queryKey: ['sites'], queryFn: () => imageServiceApi.getSites(), staleTime: 60_000 })
}

function RulesTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const onErr = useErr()
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Rule | 'new' | null>(null)
  const { data: rules = [], isLoading } = useQuery<Rule[]>({ queryKey: ['escalation-rules'], queryFn: imageServiceApi.getEscalationRules })
  const { data: sites = [] } = useSites()
  const zoneName = (id: string | null) => (sites as any[]).flatMap((s) => s.zones ?? []).find((z: any) => z.id === id)?.name
  const siteName = (id: string | null) => (sites as any[]).find((s) => s.id === id)?.name
  const remove = useMutation({
    mutationFn: (id: string) => imageServiceApi.deleteEscalationRule(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['escalation-rules'] }); qc.invalidateQueries({ queryKey: ['escalation-policies'] }); toast.success(t('ui.escalation.deleted')) },
    onError: onErr,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className={`text-sm ${themeConfig.text.secondary}`}>{t('ui.escalation.rulesHint')}</p>
        {canManage && <Button onClick={() => setEdit('new')}><Plus size={16} className="mr-1" />{t('ui.escalation.newRule')}</Button>}
      </div>
      {isLoading ? <TableSkeleton rows={3} cols={4} /> : !rules.length ? (
        <p className={`py-10 text-center ${themeConfig.text.secondary}`}>{t('ui.escalation.noRules')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead className={themeConfig.tableHeader}>
              <tr>
                <th className="px-4 py-3 text-left font-medium">{t('ui.escalation.alertType')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('ui.escalation.where')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('ui.escalation.policy')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('ui.escalation.enabled')}</th>
                {canManage && <th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className={themeConfig.tableRow}>
              {rules.map((r) => (
                <tr key={r.id} className={themeConfig.tableBorder}>
                  <td className="px-4 py-3">{r.alertType ? t(`ui.escalation.type.${r.alertType}`, r.alertType) : t('ui.escalation.anyType')}</td>
                  <td className="px-4 py-3">{r.zoneId ? `${siteName(r.siteId) ?? ''} › ${zoneName(r.zoneId) ?? '?'}` : r.siteId ? siteName(r.siteId) ?? '?' : t('ui.escalation.anywhere')}</td>
                  <td className="px-4 py-3">{r.policy?.name}{r.policy && !r.policy.enabled && <span className="ml-1 text-xs text-amber-300">({t('ui.escalation.disabled')})</span>}</td>
                  <td className="px-4 py-3 text-center">{r.enabled ? <CheckCircle size={14} className="inline text-green-400" aria-label={t('ui.escalation.enabled')} /> : <XCircle size={14} className="inline text-red-400" aria-label={t('ui.escalation.disabled')} />}</td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="secondary" size="sm" onClick={() => setEdit(r)} title={t('common.edit')}><Edit3 size={14} /></Button>
                        <Button variant="secondary" size="sm" className="!text-red-400 hover:!bg-red-500/20" onClick={() => remove.mutate(r.id)} title={t('common.delete')}><Trash2 size={14} /></Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <RuleModal rule={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function RuleModal({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const onErr = useErr()
  const qc = useQueryClient()
  const { data: sites = [] } = useSites()
  const { data: policies = [] } = useQuery<Policy[]>({ queryKey: ['escalation-policies'], queryFn: imageServiceApi.getEscalationPolicies })
  const [alertType, setAlertType] = useState(rule?.alertType ?? '')
  const [siteId, setSiteId] = useState(rule?.siteId ?? '')
  const [zoneId, setZoneId] = useState(rule?.zoneId ?? '')
  const [policyId, setPolicyId] = useState(rule?.policyId ?? '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const zones = useMemo(() => ((sites as any[]).find((s) => s.id === siteId)?.zones ?? []) as any[], [sites, siteId])
  const save = useMutation({
    mutationFn: (data: any) => (rule ? imageServiceApi.updateEscalationRule(rule.id, data) : imageServiceApi.createEscalationRule(data)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['escalation-rules'] }); qc.invalidateQueries({ queryKey: ['escalation-policies'] }); toast.success(t('common.saveSuccess')); onClose() },
    onError: onErr,
  })

  return (
    <Modal isOpen onClose={onClose} title={rule ? t('ui.escalation.editRule') : t('ui.escalation.newRule')} size="xl">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>{t('ui.escalation.alertType')}</label>
          <SearchableSelect value={alertType} onChange={setAlertType} options={[{ value: '', label: t('ui.escalation.anyType') }, ...ESCALATION_ALERT_TYPES.map((a) => ({ value: a, label: t(`ui.escalation.type.${a}`, a) }))]} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{t('ui.escalation.site')}</label>
            <SearchableSelect value={siteId} onChange={(v: string) => { setSiteId(v); setZoneId('') }} options={[{ value: '', label: t('ui.escalation.anywhere') }, ...(sites as any[]).map((s) => ({ value: s.id, label: s.name }))]} />
          </div>
          <div>
            <label className={labelClass}>{t('ui.escalation.zone')}</label>
            <SearchableSelect value={zoneId} onChange={setZoneId} options={[{ value: '', label: t('ui.escalation.wholeSite') }, ...zones.map((z) => ({ value: z.id, label: z.name }))]} />
          </div>
        </div>
        <div>
          <label className={labelClass}>{t('ui.escalation.policy')}</label>
          <SearchableSelect value={policyId} onChange={setPolicyId} placeholder={t('common.select')} options={policies.map((p) => ({ value: p.id, label: p.enabled ? p.name : `${p.name} (${t('ui.escalation.disabled')})` }))} />
        </div>
        <label className="flex items-center gap-2 text-sm text-white"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{t('ui.escalation.enabled')}</label>
        <p className="text-xs text-slate-400">{t('ui.escalation.ruleOrderHint')}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!policyId || save.isPending} onClick={() => save.mutate({ alertType: alertType || null, siteId: siteId || null, zoneId: zoneId || null, policyId, enabled })}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Preview, summary, Telegram status ────────────────────────────────────────

function PreviewTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation()
  const { themeConfig } = useTheme()
  const toast = useToast()
  const onErr = useErr()
  const [alertType, setAlertType] = useState<string>('camera_offline')
  const [cameraId, setCameraId] = useState('')
  const { data: cameras } = useQuery({ queryKey: ['escalation-cameras'], queryFn: () => imageServiceApi.getCameras({ limit: 1000 }), staleTime: 60_000 })
  const cameraList = ((cameras as any)?.data ?? cameras ?? []) as any[]
  const { data: preview, isFetching } = useQuery({
    queryKey: ['escalation-preview', alertType, cameraId],
    queryFn: () => imageServiceApi.previewEscalation({ alertType, ...(cameraId ? { cameraId } : {}) }),
  })
  const { data: settings } = useQuery({ queryKey: ['escalation-settings'], queryFn: imageServiceApi.getEscalationSettings })
  const sendWeekly = useMutation({
    mutationFn: () => imageServiceApi.sendEscalationWeekly(),
    onSuccess: (r: any) => (r?.sent && r.sent === r.chats ? toast.success(t('ui.escalation.summarySent')) : toast.error(t('ui.escalation.testPartial', { sent: r?.sent ?? 0, chats: r?.chats ?? 0 }))),
    onError: onErr,
  })
  const days = [t('ui.escalation.sun'), t('ui.escalation.mon'), t('ui.escalation.tue'), t('ui.escalation.wed'), t('ui.escalation.thu'), t('ui.escalation.fri'), t('ui.escalation.sat')]
  const send = useMutation({
    mutationFn: () => imageServiceApi.sendEscalationSummary(),
    onSuccess: (r: any) => (r?.sent && r.sent === r.chats ? toast.success(t('ui.escalation.summarySent')) : toast.error(t('ui.escalation.testPartial', { sent: r?.sent ?? 0, chats: r?.chats ?? 0 }))),
    onError: onErr,
  })
  const tg = settings?.telegram

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="rounded-lg border border-white/15 p-4 bg-white/[0.03]">
        <h3 className="font-semibold text-white mb-1">{t('ui.escalation.previewTitle')}</h3>
        <p className={`text-xs mb-3 ${themeConfig.text.secondary}`}>{t('ui.escalation.previewHint')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <SearchableSelect value={alertType} onChange={setAlertType} options={ESCALATION_ALERT_TYPES.map((a) => ({ value: a, label: t(`ui.escalation.type.${a}`, a) }))} />
          <SearchableSelect value={cameraId} onChange={setCameraId} placeholder={t('ui.escalation.anyCamera')} options={[{ value: '', label: t('ui.escalation.anyCamera') }, ...cameraList.map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        {isFetching ? <TableSkeleton rows={2} cols={2} /> : !preview?.policy ? (
          <p className="text-sm text-amber-300">{t('ui.escalation.noPolicyMatches')}</p>
        ) : (
          <div>
            <p className="text-sm text-white mb-2">{t('ui.escalation.followsPolicy', { name: preview.policy.name })}</p>
            <ol className="space-y-2">
              <li className="text-sm text-slate-300">⏱ {t('ui.escalation.atStart')}: {t('ui.escalation.defaultGroup')} ({t('ui.escalation.firstNotice')})</li>
              {preview.timeline.map((row: any) => (
                <li key={row.step} className="text-sm text-slate-200">
                  <span className="text-cyan-300 font-medium">{t('ui.escalation.stepN', { n: row.step })}</span>{' '}
                  {row.step === 1 ? t('ui.escalation.atStart') : t('ui.escalation.afterTime', { time: hoursText(row.afterMinutes, t) })}:{' '}
                  {row.targets.length ? row.targets.map((x: any) => (x.type === 'default' ? t('ui.escalation.defaultGroup') : `${x.name ?? '?'}${x.hasChat ? '' : ` (${t('ui.escalation.noGroup')})`}`)).join(', ') : <span className="text-amber-300">{t('ui.escalation.noTargets')}</span>}
                </li>
              ))}
              <li className="text-sm text-slate-400">🔁 {t('ui.escalation.thenRepeat', { time: hoursText(preview.policy.repeatMinutes, t) })}</li>
            </ol>
            <p className="text-xs text-slate-500 mt-3">{t('ui.escalation.ackStops')}</p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-white/15 p-4 bg-white/[0.03]">
          <h3 className="font-semibold text-white mb-1">{t('ui.escalation.summaryTitle')}</h3>
          <p className={`text-sm ${themeConfig.text.secondary}`}>
            {settings ? (settings.summaryEnabled ? t('ui.escalation.summaryAt', { time: settings.summaryTime }) : t('ui.escalation.summaryOff')) : '…'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {t('ui.escalation.summaryChangeHint')} <Link to="/cctv/system-config" className="text-cyan-300 underline">{t('ui.escalation.systemConfigLink')}</Link>
          </p>
          {canManage && <Button className="mt-3" size="sm" onClick={() => send.mutate()} disabled={send.isPending}><Send size={14} className="mr-1" />{t('ui.escalation.sendSummaryNow')}</Button>}
          <p className="text-xs text-slate-400 mt-2">{settings ? (settings.enabled ? t('ui.escalation.engineOn', { days: settings.maxAckDays }) : t('ui.escalation.engineOff')) : ''}</p>
        </div>
        <div className="rounded-lg border border-white/15 p-4 bg-white/[0.03]">
          <h3 className="font-semibold text-white mb-1">{t('ui.escalation.weeklyTitle')}</h3>
          <p className={`text-sm ${themeConfig.text.secondary}`}>
            {!settings?.weekly ? '…' : !settings.weekly.enabled ? t('ui.escalation.summaryOff')
              : !settings.weekly.targets?.length ? t('ui.escalation.weeklyNoTargets')
              : t('ui.escalation.weeklyAt', { day: days[settings.weekly.day] ?? settings.weekly.day, time: settings.weekly.time })}
          </p>
          <p className="text-xs text-slate-400 mt-1">{t('ui.escalation.weeklyHint')} <Link to="/cctv/system-config" className="text-cyan-300 underline">{t('ui.escalation.systemConfigLink')}</Link></p>
          {canManage && !!settings?.weekly?.targets?.length && <Button className="mt-3" size="sm" onClick={() => sendWeekly.mutate()} disabled={sendWeekly.isPending}><Send size={14} className="mr-1" />{t('ui.escalation.sendWeeklyNow')}</Button>}
        </div>
        <TelegramStatusCard last={tg} />
      </div>
    </div>
  )
}
