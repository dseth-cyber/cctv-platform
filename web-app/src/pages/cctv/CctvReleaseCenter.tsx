import React, { useState, useEffect } from 'react';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Shield,
  ShieldAlert,
  Server,
  HardDrive,
  Video,
  FileCheck,
  RefreshCw,
  Terminal,
  Database,
  ArrowRight,
  ClipboardList,
  Lock,
} from 'lucide-react';
import { imageServiceApi } from '../../services/imageServiceApi';
import { useAuth } from '@/contexts/AuthContext';

import { useTranslation } from 'react-i18next';
interface PreflightItem {
  id: string;
  category: 'isolation' | 'security' | 'storage' | 'streaming' | 'database';
  name: string;
  status: 'passed' | 'warning' | 'failed';
  details: string;
  remediation?: string;
}

interface PreflightData {
  score: number;
  overallStatus: 'ready' | 'action_required' | 'blocked';
  environment: string;
  isolationVerified: boolean;
  checkedAt: string;
  items: PreflightItem[];
}

interface PilotPlan {
  phase: string;
  targetCameras: number;
  expectedIngressMbps: number;
  expectedStoragePerDayGB: number;
  recommendedNodes: number;
  prerequisites: string[];
  acceptanceCriteria: string[];
}

interface SignoffRecord {
  id: string;
  signedAt: string;
  signedBy: string;
  targetEnvironment: string;
  scope: string;
  checklistPassed: boolean;
  notes: string;
}

export const CctvReleaseCenter: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'preflight' | 'pilot' | 'dr' | 'signoff'>('preflight');
  const [loading, setLoading] = useState(false);
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const [pilotCameras, setPilotCameras] = useState<number>(25);
  const [pilotPlan, setPilotPlan] = useState<PilotPlan | null>(null);
  const [signoffs, setSignoffs] = useState<SignoffRecord[]>([]);

  // Signoff form state
  // The server records the authenticated user as signer; this is display only.
  const signedBy = user?.username ?? '';
  const [targetEnv, setTargetEnv] = useState('pilot-staging-vlan');
  const [scope, setScope] = useState('Pilot Wave 1 (25 cams)');
  const [notes, setNotes] = useState('');
  const [submittingSignoff, setSubmittingSignoff] = useState(false);
  const [signoffSuccessMsg, setSignoffSuccessMsg] = useState('');
  const [signoffErrorMsg, setSignoffErrorMsg] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  // DR Drill simulated state

  // UAT checklist starts empty: each criterion is ticked only after someone has tested it.
  const [uatChecked, setUatChecked] = useState<Record<number, boolean>>({});

  const loadPreflight = async () => {
    try {
      setLoading(true);
      const res = await imageServiceApi.getPreflightReadiness();
      setPreflight(res);
    } catch {
      // No simulated readiness report: an unreachable API must never look "ready".
      setPreflight(null);
      setLoadError(t('ui.cctvReleaseCenter.failedToLoadPreFlightResults'));
    } finally {
      setLoading(false);
    }
  };

  const loadPilotPlan = async (cameras: number) => {
    try {
      const res = await imageServiceApi.getPilotRolloutPlan(cameras);
      setPilotPlan(res);
    } catch {
      setPilotPlan(null);
      setLoadError(t('ui.cctvReleaseCenter.failedToLoadPilotPlanNo'));
    }
  };

  const loadSignoffs = async () => {
    try {
      const res = await imageServiceApi.getReleaseSignoffs();
      if (Array.isArray(res)) setSignoffs(res);
    } catch {
      setSignoffs([]);
      setLoadError(t('ui.cctvReleaseCenter.failedToLoadSignOffHistory'));
    }
  };

  useEffect(() => {
    loadPreflight();
    loadPilotPlan(pilotCameras);
    loadSignoffs();
  }, []);

  const handleCameraSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setPilotCameras(val);
    loadPilotPlan(val);
  };

  const statusOf = (id: string) => preflight?.items.find((i) => i.id === id)?.status;
  const secretStatuses = ['sec-jwt', 'sec-enc'].map(statusOf);
  const secretStatus: PreflightItem['status'] | undefined = !preflight
    ? undefined
    : secretStatuses.includes('failed')
    ? 'failed'
    : secretStatuses.every((st) => st === 'passed')
    ? 'passed'
    : 'warning';
  const gateStatus: PreflightItem['status'] | undefined = !preflight
    ? undefined
    : preflight.overallStatus === 'ready'
    ? 'passed'
    : preflight.overallStatus === 'blocked'
    ? 'failed'
    : 'warning';
  const passedCount = preflight?.items.filter((i) => i.status === 'passed').length ?? 0;
  const totalCriteria = pilotPlan?.acceptanceCriteria.length ?? 0;
  const checkedCriteria = pilotPlan?.acceptanceCriteria.filter((_, idx) => uatChecked[idx]).length ?? 0;
  const uatComplete = totalCriteria > 0 && checkedCriteria === totalCriteria;
  const checklistPassed = preflight?.overallStatus === 'ready' && uatComplete;

  const statusTone = (st: PreflightItem['status'] | undefined) =>
    st === 'passed'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : st === 'failed'
      ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  const statusText = (st: PreflightItem['status'] | undefined) =>
    st === 'passed'
      ? 'text-emerald-600 dark:text-emerald-400'
      : st === 'failed'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-amber-600 dark:text-amber-400';
  const statusLabel = (st: PreflightItem['status'] | undefined) =>
    st === 'passed'
      ? t('ui.cctvReleaseCenter.checkPassed')
      : st === 'failed'
      ? t('ui.cctvReleaseCenter.checkFailed')
      : st === 'warning'
      ? t('ui.cctvReleaseCenter.checkWarning')
      : t('ui.cctvReleaseCenter.checkUnknown');
  const statusIcon = (st: PreflightItem['status'] | undefined, size = 'w-3.5 h-3.5') =>
    st === 'passed' ? (
      <CheckCircle className={`${size} text-emerald-500 shrink-0`} />
    ) : st === 'failed' ? (
      <XCircle className={`${size} text-rose-500 shrink-0`} />
    ) : (
      <AlertTriangle className={`${size} text-amber-500 shrink-0`} />
    );

  const handleSubmitSignoff = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingSignoff(true);
    setSignoffSuccessMsg('');
    setSignoffErrorMsg('');
    try {
      await imageServiceApi.submitReleaseSignoff({
        targetEnvironment: targetEnv,
        scope,
        notes,
        checklistPassed,
      });
      setSignoffSuccessMsg(t('ui.cctvReleaseCenter.pilotReleaseSignOffRecorded'));
      loadSignoffs();
    } catch (err: any) {
      // Never record a sign-off locally when the server rejected it (e.g. 403 without settings:update).
      setSignoffErrorMsg(err?.response?.data?.message || err?.message || t('ui.cctvReleaseCenter.failedToRecordSignOff'));
    } finally {
      setSubmittingSignoff(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <FileCheck className="w-7 h-7" />
              </span>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  {t('ui.cctvReleaseCenter.pilotReleaseCenterPhase')}
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">
                    {t('ui.cctvReleaseCenter.finalGate')}
                  </span>
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('ui.cctvReleaseCenter.releaseReadinessCenterPreFlightAudit')}
                </p>
              </div>
            </div>
          </div>

          {/* Readiness Score & Badges */}
          <div className="flex items-center gap-4">
            <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-right">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('ui.cctvReleaseCenter.readinessScore')}</div>
              <div className={`text-2xl font-black ${statusText(gateStatus)}`}>
                {preflight ? `${preflight.score}%` : '—'}
              </div>
            </div>
            <button
              onClick={loadPreflight}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {t('ui.cctvReleaseCenter.reRunPreFlight')}
            </button>
          </div>
        </div>

        {/* Isolation Alert Box */}
        {preflight?.isolationVerified ? (
          <div className="mt-5 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-start gap-3">
            <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                {t('ui.cctvReleaseCenter.failClosedIsolationVerified')}{' '}
              </span>
              <span className="text-emerald-800 dark:text-emerald-300">
                {t('ui.cctvReleaseCenter.theWholeCctvStackRunsOn')}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-5 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-semibold text-amber-900 dark:text-amber-200">
                {t('ui.cctvReleaseCenter.isolationNotVerified')}{' '}
              </span>
              <span className="text-amber-800 dark:text-amber-300">
                {t('ui.cctvReleaseCenter.isolationNotVerifiedDetail')}
              </span>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 mt-6 border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setActiveTab('preflight')}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'preflight'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Shield className="w-4 h-4" />
            {t('ui.cctvReleaseCenter.n1PreFlightSecretAudit')}
          </button>
          <button
            onClick={() => setActiveTab('pilot')}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'pilot'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            {t('ui.cctvReleaseCenter.n2PilotGatesUatChecklist')}
          </button>
          <button
            onClick={() => setActiveTab('dr')}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'dr'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            {t('ui.cctvReleaseCenter.n3BackupDrDrill')}
          </button>
          <button
            onClick={() => setActiveTab('signoff')}
            className={`pb-3 px-4 text-sm font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'signoff'
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <FileCheck className="w-4 h-4" />
            {t('ui.cctvReleaseCenter.n4SignOffReleaseAuthorization')}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {loadError}
        </div>
      )}

      {/* TAB 1: PRE-FLIGHT & SECRET AUDIT */}
      {activeTab === 'preflight' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('ui.cctvReleaseCenter.environment')}</span>
                <span className="text-xs px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-700 font-mono text-slate-700 dark:text-slate-300">
                  {preflight?.environment.toUpperCase()}
                </span>
              </div>
              <div className="mt-3 text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Server className="w-5 h-5 text-indigo-500" />
                {t('ui.cctvReleaseCenter.localIsolationMode')}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t('ui.cctvReleaseCenter.mediaMTXPostgreSQLRedisSeaweedFSRunIn')}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('ui.cctvReleaseCenter.secretHygiene')}</span>
                <span className={`text-xs px-2.5 py-1 rounded font-medium ${statusTone(secretStatus)}`}>
                  {statusLabel(secretStatus)}
                </span>
              </div>
              <div className="mt-3 text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Lock className={`w-5 h-5 ${statusText(secretStatus)}`} />
                {secretStatus === 'passed'
                  ? t('ui.cctvReleaseCenter.noDefaultSecretsInStaging')
                  : t('ui.cctvReleaseCenter.secretsNeedAttention')}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {secretStatus === 'passed'
                  ? t('ui.cctvReleaseCenter.jwtSecretAndEncryptionKeyMeet')
                  : t('ui.cctvReleaseCenter.secretsNeedAttentionDetail')}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('ui.cctvReleaseCenter.statusGate')}</span>
                <span className={`text-xs px-2.5 py-1 rounded font-semibold ${statusTone(gateStatus)}`}>
                  {statusLabel(gateStatus)}
                </span>
              </div>
              <div className={`mt-3 text-xl font-bold flex items-center gap-2 ${statusText(gateStatus)}`}>
                {statusIcon(gateStatus, 'w-5 h-5')}
                {!preflight
                  ? t('ui.cctvReleaseCenter.gateUnknown')
                  : preflight.overallStatus === 'ready'
                  ? t('ui.cctvReleaseCenter.readyForPilotRollout')
                  : preflight.overallStatus === 'blocked'
                  ? t('ui.cctvReleaseCenter.gateBlocked')
                  : t('ui.cctvReleaseCenter.gateActionRequired')}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t('ui.cctvReleaseCenter.passedChecksCount', { passed: passedCount, total: preflight?.items.length ?? 0 })}
              </p>
            </div>
          </div>

          {/* Preflight Checklist Table */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-indigo-500" />
                {t('ui.cctvReleaseCenter.preFlightInspectionItems')}{preflight?.items.length ?? 0}{' '}{t('ui.cctvReleaseCenter.items')}
              </h2>
              <span className="text-xs text-slate-400">
                {t('ui.cctvReleaseCenter.lastChecked')}{' '}{preflight ? new Date(preflight.checkedAt).toLocaleTimeString() : '-'}
              </span>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {preflight?.items.map((item) => (
                <div key={item.id} className="p-5 flex items-start gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-750 transition-colors">
                  <div className="mt-0.5">
                    {item.status === 'passed' ? (
                      <CheckCircle className="w-5 h-5 text-emerald-500" />
                    ) : item.status === 'warning' ? (
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white text-sm">
                        {item.name}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {item.category}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{item.details}</p>
                    {item.remediation && (
                      <div className="mt-2 text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 p-2 rounded border border-amber-200 dark:border-amber-800 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{t('ui.cctvReleaseCenter.recommendation')}{' '}{item.remediation}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        item.status === 'passed'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : item.status === 'warning'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300'
                      }`}
                    >
                      {item.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PILOT GATES & UAT CHECKLIST */}
      {activeTab === 'pilot' && (
        <div className="space-y-6">
          {/* Sizing Controller Card */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Video className="w-5 h-5 text-indigo-500" />
              {t('ui.cctvReleaseCenter.pilotRolloutWavePlanner')}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {t('ui.cctvReleaseCenter.adjustThePilotCameraCountTo')}
            </p>

            <div className="mt-5">
              <div className="flex justify-between text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                <span>{t('ui.cctvReleaseCenter.pilotCameras')}{' '}{pilotCameras}{' '}{t('ui.cctvReleaseCenter.cams')}</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{pilotPlan?.phase}</span>
              </div>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={pilotCameras}
                onChange={handleCameraSliderChange}
                className="w-full accent-indigo-600 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                <span>{t('ui.cctvReleaseCenter.n5CamsMinimal')}</span>
                <span>{t('ui.cctvReleaseCenter.n25CamsCanaryWave')}</span>
                <span>{t('ui.cctvReleaseCenter.n50CamsSubZone')}</span>
                <span>{t('ui.cctvReleaseCenter.n100CamsFullStaging')}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-5 border-t border-slate-200 dark:border-slate-700">
              <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg">
                <div className="text-xs text-slate-500">{t('ui.cctvReleaseCenter.ingressBandwidth')}</div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                  ~{pilotPlan?.expectedIngressMbps}{' '}{t('ui.cctvReleaseCenter.mbps')}
                </div>
                <div className="text-[10px] text-slate-400">{t('ui.cctvReleaseCenter.n20MbpsPerChannel')}</div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg">
                <div className="text-xs text-slate-500">{t('ui.cctvReleaseCenter.dailyStorage')}</div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                  ~{pilotPlan?.expectedStoragePerDayGB}{' '}{t('ui.cctvReleaseCenter.gbDay')}
                </div>
                <div className="text-[10px] text-slate-400">{t('ui.cctvReleaseCenter.n216GbChannelDay')}</div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg">
                <div className="text-xs text-slate-500">{t('ui.cctvReleaseCenter.n7DayRetentionPool')}</div>
                <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                  ~{(((pilotPlan?.expectedStoragePerDayGB ?? 0) * 7) / 1000).toFixed(1)}{' '}{t('ui.cctvReleaseCenter.tb')}
                </div>
                <div className="text-[10px] text-slate-400">{t('ui.cctvReleaseCenter.rollingBufferFMP')}</div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg">
                <div className="text-xs text-slate-500">{t('ui.cctvReleaseCenter.recommendedMediaNodes')}</div>
                <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                  {pilotPlan?.recommendedNodes}{' '}{t('ui.cctvReleaseCenter.nodeActiveStandby')}
                </div>
                <div className="text-[10px] text-slate-400">{t('ui.cctvReleaseCenter.n1Gbps25GbpsUplink')}</div>
              </div>
            </div>
          </div>

          {/* UAT Checklist */}
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
              <ClipboardList className="w-5 h-5 text-indigo-500" />
              {t('ui.cctvReleaseCenter.uatAcceptanceCriteriaChecklist', { count: totalCriteria })}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              {t('ui.cctvReleaseCenter.clickToConfirmThatResultsIn')}
            </p>

            <div className="space-y-3">
              {pilotPlan?.acceptanceCriteria.map((criterion, idx) => (
                <label
                  key={idx}
                  className={`flex items-start gap-3 p-3.5 rounded-lg border transition-all cursor-pointer ${
                    uatChecked[idx]
                      ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800'
                      : 'bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={uatChecked[idx] ?? false}
                    onChange={(e) =>
                      setUatChecked((prev) => ({ ...prev, [idx]: e.target.checked }))
                    }
                    className="mt-1 w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {t('ui.cctvReleaseCenter.criterion')}{' '}{idx + 1}: {criterion}
                    </span>
                  </div>
                  {uatChecked[idx] && (
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium">
                      {t('ui.cctvReleaseCenter.pass')}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: BACKUP & DR DRILL */}
      {activeTab === 'dr' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-500" />
                  {t('ui.cctvReleaseCenter.disasterRecoveryDrBackupDrill')}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {t('ui.cctvReleaseCenter.runbookAndCommandsForDatabaseBackup')}
                </p>
              </div>
              {/* [R1.8] No automated drill exists yet; never show a fabricated SUCCESS result. */}
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 max-w-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {t('ui.cctvReleaseCenter.noAutomatedDrDrillYetRun')}
              </div>
            </div>

            {/* Runbook Snippets */}
            <div className="mt-6 space-y-4">
              <div className="p-4 bg-slate-900 rounded-lg text-slate-200 font-mono text-xs">
                <div className="text-slate-400 mb-1">{t('ui.cctvReleaseCenter.n1BackUpThePostgreSQLDatabase')}</div>
                <div className="text-emerald-400">
                  docker compose exec -T postgres pg_dump -U postgres cctv_db | gzip &gt; /backups/cctv_db_$(date +%Y%m%d_%H%M%S).sql.gz
                </div>
              </div>

              <div className="p-4 bg-slate-900 rounded-lg text-slate-200 font-mono text-xs">
                <div className="text-slate-400 mb-1">{t('ui.cctvReleaseCenter.n2RestoreTheDatabaseRestoreTest')}</div>
                <div className="text-emerald-400">
                  gunzip -c /backups/cctv_db_20261027_000000.sql.gz | docker compose exec -T postgres psql -U postgres -d cctv_db_dr_test
                </div>
              </div>

              <div className="p-4 bg-slate-900 rounded-lg text-slate-200 font-mono text-xs">
                <div className="text-slate-400 mb-1">{t('ui.cctvReleaseCenter.n3EmergencyCameraStreamEvacuationMedia')}</div>
                <div className="text-emerald-400">
                  curl -X POST http://127.0.0.1:3000/api/v1/media-nodes/node-edge-01/failover -H "Authorization: Bearer $JWT"
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SIGNOFF & RELEASE AUTHORIZATION */}
      {activeTab === 'signoff' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sign-off Form */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
                <FileCheck className="w-5 h-5 text-indigo-500" />
                {t('ui.cctvReleaseCenter.pilotReleaseSignOffForm')}
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                {t('ui.cctvReleaseCenter.formallyAcceptTheCctvPlatformInto')}
              </p>

              {signoffErrorMsg && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                  {signoffErrorMsg}
                </div>
              )}
              {signoffSuccessMsg && (
                <div className="mb-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
                  {signoffSuccessMsg}
                </div>
              )}

              <form onSubmit={handleSubmitSignoff} className="space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('ui.cctvReleaseCenter.signedOffBy')}
                  </label>
                  <input
                    type="text"
                    value={signedBy}
                    readOnly
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('ui.cctvReleaseCenter.targetEnvironment')}
                  </label>
                  <input
                    type="text"
                    value={targetEnv}
                    onChange={(e) => setTargetEnv(e.target.value)}
                    required
                    maxLength={64}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    {t('ui.cctvReleaseCenter.mustBeAServerOrVlan')}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('ui.cctvReleaseCenter.scope')}
                  </label>
                  <input
                    type="text"
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    required
                    maxLength={32}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('ui.cctvReleaseCenter.releaseNotesAssurance')}
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                  />
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-white">{t('ui.cctvReleaseCenter.architectureAssurance')}</div>
                  <div className="flex items-center gap-1.5">
                    {statusIcon(statusOf('iso-fail-closed'))}
                    {t('ui.cctvReleaseCenter.assuranceIsolation')}: {statusLabel(statusOf('iso-fail-closed'))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {statusIcon(secretStatus)}
                    {t('ui.cctvReleaseCenter.assuranceSecrets')}: {statusLabel(secretStatus)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {statusIcon(gateStatus)}
                    {t('ui.cctvReleaseCenter.assurancePreflight')}: {statusLabel(gateStatus)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {statusIcon(uatComplete ? 'passed' : 'warning')}
                    {t('ui.cctvReleaseCenter.assuranceUat', { done: checkedCriteria, total: totalCriteria })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {statusIcon('warning')}
                    {t('ui.cctvReleaseCenter.assuranceDr')}
                  </div>
                </div>

                {!checklistPassed && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {t('ui.cctvReleaseCenter.checklistIncompleteWarning')}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submittingSignoff}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <FileCheck className="w-4 h-4" />
                  {submittingSignoff ? t('common.saving') : t('ui.cctvReleaseCenter.approveSignPilotRelease')}
                </button>
              </form>
            </div>

            {/* Sign-off Audit Trail History */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
                <ShieldAlert className="w-5 h-5 text-indigo-500" />
                {t('ui.cctvReleaseCenter.signOffAuditTrail')}
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                {t('ui.cctvReleaseCenter.releaseApprovalsRecordedInTheAudit')}
              </p>

              <div className="space-y-3">
                {signoffs.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <div className="flex items-center justify-between font-semibold text-slate-900 dark:text-white">
                      <span>{item.scope}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] ${statusTone(item.checklistPassed ? 'passed' : 'warning')}`}>
                        {item.checklistPassed ? t('ui.cctvReleaseCenter.approved') : t('ui.cctvReleaseCenter.signedChecklistNotPassed')}
                      </span>
                    </div>
                    <div className="text-slate-500 mt-1 flex items-center gap-2 text-[11px]">
                      <span>{t('ui.cctvReleaseCenter.approver')}{' '}{item.signedBy}</span>
                      <span>•</span>
                      <span>{t('ui.cctvReleaseCenter.target')}{' '}{item.targetEnvironment}</span>
                      <span>•</span>
                      <span>{new Date(item.signedAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-2 text-slate-600 dark:text-slate-300 italic bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700">
                      "{item.notes}"
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CctvReleaseCenter;
