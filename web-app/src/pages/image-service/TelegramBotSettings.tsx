import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Save, Send, Eye, EyeOff, MessageCircle, CheckCircle, XCircle, ShieldCheck, UserPlus, Trash2, Check, X, Clock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';

const SETTINGS_KEY = 'image-service-telegram-settings';

export default function TelegramBotSettings() {
  const { t } = useTranslation();
  const { themeConfig } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [allowPrivateChat, setAllowPrivateChat] = useState(true);
  const [newUserId, setNewUserId] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [llm, setLlm] = useState({ enabled: false, baseUrl: '', model: '', timeout: '60' });
  const [llmKeyInput, setLlmKeyInput] = useState('');
  const [llmKeySet, setLlmKeySet] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['telegram-settings'],
    queryFn: async () => {
      const data = await imageServiceApi.getTelegramSettings();
      setBotToken(data.telegram_bot_token ?? '');
      setChatId(data.telegram_chat_id ?? '');
      setApiBaseUrl(data.telegram_api_base_url ?? '');
      setApiToken(data.telegram_api_token ?? '');
      // Absent means on — matches the backend default in telegram-api.ts.
      setAllowPrivateChat(data.telegram_allow_private_chat !== 'false');
      return data;
    },
    staleTime: 1000 * 60,
  });

  const saveMutation = useMutation({
    mutationFn: (data: any) => imageServiceApi.updateTelegramSettings(data),
    onSuccess: () => {
      toast.success(t('common.saveSuccess'));
      queryClient.invalidateQueries({ queryKey: ['telegram-settings'] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const { data: botUsers } = useQuery({
    queryKey: ['telegram-users'],
    queryFn: () => imageServiceApi.getTelegramUsers(),
    staleTime: 1000 * 30,
  });
  const botUsersArr: any[] = Array.isArray(botUsers?.data) ? botUsers.data : [];

  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: ['telegram-users'] });
  const onMutationError = (e: any) => { if (!e?._handled) toast.error(t('common.error')); };

  const addUserMutation = useMutation({
    mutationFn: (data: { telegramId: string; firstName?: string }) => imageServiceApi.addTelegramUser(data),
    onSuccess: () => { invalidateUsers(); setNewUserId(''); setNewUserName(''); toast.success(t('common.saveSuccess')); },
    onError: onMutationError,
  });

  const statusMutation = useMutation({
    mutationFn: (v: { telegramId: string; status: 'approved' | 'rejected' }) =>
      imageServiceApi.setTelegramUserStatus(v.telegramId, v.status),
    onSuccess: () => { invalidateUsers(); toast.success(t('common.saveSuccess')); },
    onError: onMutationError,
  });

  const deleteUserMutation = useMutation({
    mutationFn: (telegramId: string) => imageServiceApi.deleteTelegramUser(telegramId),
    onSuccess: () => { invalidateUsers(); toast.success(t('common.deleted')); },
    onError: onMutationError,
  });

  useQuery({
    queryKey: ['llm-settings'],
    queryFn: async () => {
      const d = await imageServiceApi.getLlmSettings();
      setLlm({
        enabled: d.llm_enabled === 'true',
        baseUrl: d.llm_base_url ?? '',
        model: d.llm_model ?? '',
        timeout: d.llm_timeout_seconds ?? '60',
      });
      setLlmKeySet(Boolean(d.llm_api_key_set));
      return d;
    },
    staleTime: 1000 * 60,
  });

  const saveLlm = useMutation({
    mutationFn: (data: Record<string, string>) => imageServiceApi.updateLlmSettings(data),
    onSuccess: () => {
      toast.success(t('common.saveSuccess'));
      setLlmKeyInput('');
      queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const clearLlmKey = useMutation({
    mutationFn: () => imageServiceApi.clearLlmApiKey(),
    onSuccess: () => { setLlmKeySet(false); toast.success(t('common.deleted')); queryClient.invalidateQueries({ queryKey: ['llm-settings'] }); },
    onError: (e: any) => { if (!e?._handled) toast.error(t('common.error')); },
  });

  const handleSaveLlm = () => {
    saveLlm.mutate({
      llm_enabled: String(llm.enabled),
      llm_base_url: llm.baseUrl.trim(),
      llm_model: llm.model.trim(),
      llm_timeout_seconds: llm.timeout,
      // Empty means "keep the stored key" — the backend skips it rather than erasing.
      llm_api_key: llmKeyInput,
    });
  };

  const handleSave = () => {
    setSaving(true);
    saveMutation.mutate({
      telegram_bot_token: botToken,
      telegram_chat_id: chatId,
      telegram_api_base_url: apiBaseUrl,
      telegram_api_token: apiToken,
      telegram_allow_private_chat: String(allowPrivateChat),
    }, { onSettled: () => setSaving(false) });
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const text = '✅ *iSmart CCTV* — Test connection successful!';
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
      if (res.ok) {
        setTestResult({ ok: true, message: t('ui.telegramBotSettings.messageSentSuccessfullyCheckYourTelegram') });
      } else {
        const err = await res.text();
        setTestResult({ ok: false, message: t('ui.telegramBotSettings.failed', { err }) });
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message ?? t('ui.telegramBotSettings.connectionFailed') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      {/* Fake inputs to trap browser autofill at page-level */}
      <input type="text" style={{ display: 'none' }} autoComplete="username" />
      <input type="password" style={{ display: 'none' }} autoComplete="new-password" />

      <div className="mb-6">
        <p className={`text-xs font-medium uppercase tracking-widest ${themeConfig.text.secondary}`}>
          iSmart CCTV · {t('imageService.telegramBot.title')}
        </p>
        <h1 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.telegramBot.title')}</h1>
        <p className={`text-sm mt-1 ${themeConfig.text.secondary}`}>
          {t('imageService.telegramBot.subtitle')}
        </p>
      </div>

      <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-sky-500/10">
            <MessageCircle size={18} className="text-sky-400" />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.telegramBot.botConfiguration')}</h3>
          </div>
        </div>

        <div className="space-y-4">
          {/* Fake inputs to trap browser autofill and prevent it from filling search and token inputs */}
          <input type="text" style={{ display: 'none' }} autoComplete="username" />
          <input type="password" style={{ display: 'none' }} autoComplete="new-password" />

          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.telegramBot.botToken')}</label>
            <div className="relative">
              <input value={botToken} onChange={e => setBotToken(e.target.value)}
                type={showToken ? 'text' : 'password'}
                placeholder="1234567890:ABCdefGHIjklmNOPqrSTUvwxYZ"
                autoComplete="new-password" data-1p-ignore data-lpignore="true" data-form-type="other"
                className={`w-full px-4 py-2.5 rounded-md text-sm border font-mono ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50 pr-10`} />
              <button onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1.5 ${themeConfig.text.primary}`}>{t('imageService.telegramBot.groupChatId')}</label>
            <input value={chatId} onChange={e => setChatId(e.target.value)}
              placeholder="-1003722831807"
              className={`w-full px-4 py-2.5 rounded-md text-sm border font-mono ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
            <p className={`text-xs mt-1 ${themeConfig.text.secondary}`}>
              {t('imageService.telegramBot.groupIdHint')}
            </p>
          </div>

        </div>
      </div>

      {/* Private-chat allowlist. The group chat is always allowed — it is the configured
          alert destination — so this only gates 1:1 DMs, where anyone who finds the bot's
          @username could otherwise message it. */}
      <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <ShieldCheck size={18} className="text-emerald-400" />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${themeConfig.text.primary}`}>{t('imageService.telegramBot.access')}</h3>
            <p className={`text-xs ${themeConfig.text.secondary}`}>{t('imageService.telegramBot.accessDesc')}</p>
          </div>
        </div>

        <div className={`rounded-md border ${themeConfig.inputBorder} px-4 py-3 mb-4 space-y-2`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className={`text-sm ${themeConfig.text.primary}`}>{t('imageService.telegramBot.groupAlwaysAllowed')}</span>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={allowPrivateChat} onChange={e => setAllowPrivateChat(e.target.checked)}
              className="rounded border-gray-600 text-cyan-500 focus:ring-cyan-500/50" />
            <span className={`text-sm ${themeConfig.text.primary}`}>{t('imageService.telegramBot.allowPrivateChat')}</span>
          </label>
        </div>

        <p className={`text-sm font-medium mb-2 ${themeConfig.text.primary}`}>
          {t('imageService.telegramBot.approvedList', { count: botUsersArr.length })}
        </p>

        {botUsersArr.length === 0 ? (
          <p className={`text-sm italic ${themeConfig.text.secondary}`}>{t('common.noData')}</p>
        ) : (
          <div className="space-y-2">
            {botUsersArr.map((u: any) => (
              <div key={u.telegramId} className={`flex items-center justify-between px-4 py-2.5 rounded-md border ${themeConfig.inputBorder}`}>
                <div className="min-w-0">
                  <div className={`text-sm font-medium truncate ${themeConfig.text.primary}`}>
                    {u.firstName || u.username || u.telegramId}
                    {u.status === 'pending' && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 inline-flex items-center gap-1">
                        <Clock size={11} /> {t('imageService.telegramBot.statusPending')}
                      </span>
                    )}
                    {u.status === 'rejected' && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                        {t('imageService.telegramBot.statusRejected')}
                      </span>
                    )}
                  </div>
                  <div className={`text-xs font-mono ${themeConfig.text.secondary}`}>{u.telegramId}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {u.status !== 'approved' && (
                    <button onClick={() => statusMutation.mutate({ telegramId: u.telegramId, status: 'approved' })}
                      title={t('imageService.telegramBot.approve')}
                      className="p-1.5 rounded hover:bg-green-500/10 text-green-400">
                      <Check size={14} />
                    </button>
                  )}
                  {u.status !== 'rejected' && (
                    <button onClick={() => statusMutation.mutate({ telegramId: u.telegramId, status: 'rejected' })}
                      title={t('imageService.telegramBot.reject')}
                      className="p-1.5 rounded hover:bg-amber-500/10 text-amber-400">
                      <X size={14} />
                    </button>
                  )}
                  <button onClick={() => deleteUserMutation.mutate(u.telegramId)}
                    title={t('common.delete')}
                    className="p-1.5 rounded hover:bg-red-500/10 text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4">
          <input value={newUserId} onChange={e => setNewUserId(e.target.value.replace(/\D/g, ''))}
            placeholder={t('ui.telegramBotSettings.telegramId')} inputMode="numeric"
            className={`w-40 px-3 py-2 rounded-md text-sm border font-mono ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
          <input value={newUserName} onChange={e => setNewUserName(e.target.value)}
            placeholder={t('imageService.telegramBot.nameOptional')}
            className={`flex-1 px-3 py-2 rounded-md text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none focus:ring-1 focus:ring-cyan-500/50`} />
          <button
            onClick={() => addUserMutation.mutate({ telegramId: newUserId, firstName: newUserName || undefined })}
            disabled={newUserId.length < 5 || addUserMutation.isPending}
            title={t('imageService.telegramBot.addUser')}
            className="p-2 rounded-md bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
            <UserPlus size={16} />
          </button>
        </div>
        <p className={`text-xs mt-2 ${themeConfig.text.secondary}`}>{t('imageService.telegramBot.addUserHint')}</p>
        <p className="text-xs mt-2 text-amber-400">⚠️ {t('imageService.telegramBot.rememberSave')}</p>
      </div>

      {/* The AI (LLM) settings card was removed from this page: nothing in the system uses it (no /insights). */}

      <div className={`${themeConfig.card} rounded-lg p-6 mb-5`}>
        <h4 className={`text-sm font-semibold mb-3 ${themeConfig.text.primary}`}>{t('imageService.telegramBot.howToGetToken')}</h4>
        <ol className={`text-sm space-y-2 ${themeConfig.text.secondary} list-decimal list-inside`}>
          <li>{t('imageService.telegramBot.step1')}</li>
          <li>{t('imageService.telegramBot.step2')}</li>
          <li>{t('imageService.telegramBot.step3')}</li>
          <li>{t('imageService.telegramBot.step4')}</li>
          <li>{t('imageService.telegramBot.step5')}</li>
        </ol>
      </div>

      {testResult && (
        <div className={`mb-5 px-4 py-3 rounded-lg flex items-center gap-2 ${testResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
          <span className="text-sm">{testResult.message}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          <Save size={16} className="mr-1.5" />
          {saving ? t('common.saving') : t('common.save')}
        </Button>
        <Button variant="secondary" onClick={handleTestConnection} disabled={testing || !botToken || !chatId}>
          <Send size={16} className="mr-1.5" />
          {testing ? t('imageService.telegramBot.testing') : t('imageService.telegramBot.testConnection')}
        </Button>
      </div>
    </div>
  );
}
