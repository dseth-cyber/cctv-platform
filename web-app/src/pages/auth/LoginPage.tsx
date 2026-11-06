import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { imageServiceApi } from '@/services/imageServiceApi'
import { Camera, Eye, EyeOff, User, Lock, ArrowRight } from 'lucide-react'

export default function LoginPage({ logoBase64 }: { logoBase64?: string }) {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const { themeConfig, theme, setTheme } = useTheme()

  useEffect(() => {
    if (theme !== 'modern') {
      setTheme('modern')
    }
  }, [theme, setTheme])
  
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Query configurations dynamically to populate branding elements
  const { data: configs } = useQuery({
    queryKey: ['system-branding'],
    queryFn: () => imageServiceApi.getSystemBranding(),
  })
  
  const configMap = configs ?? {}
  const appName = configMap.system_name?.value ?? 'iSmart CCTV'
  const appDescription = configMap.system_description?.value ?? 'Enterprise CCTV Management System'
  const appVersion = configMap.system_version?.value ?? '1.0.0'
  const appCopyright = configMap.system_copyright?.value ?? '© 2026 Chiotron. All rights reserved.'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username || !password) {
      setError(t('imageService.auth.required'))
      return
    }
    setLoading(true)
    try {
      await login(username, password)
      navigate('/cctv/overview', { replace: true })
    } catch (err: any) {
      // Distinguish the account-lockout case (too many failed attempts) from a plain
      // wrong password — matched on the backend's message text since that's the only
      // signal available (no separate machine-readable error code), same pattern used
      // throughout this app's alert-translation code.
      const backendMessage: string | undefined = err?.response?.data?.message
      setError(backendMessage?.toLowerCase().includes('locked')
        ? t('imageService.auth.locked')
        : t('imageService.auth.invalid'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center ${themeConfig.background} px-4 py-8 relative overflow-hidden`}>
      <div 
        className="absolute inset-0 pointer-events-none" 
        style={{ 
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.04) 1px, transparent 0)', 
          backgroundSize: '24px 24px' 
        }}
      />
      {/* Header section with stacked logo and description */}
      <div className="flex flex-col items-center justify-center mb-6">
        {logoBase64 ? (
          <img src={logoBase64} alt={t('ui.loginPage.logo')} className="h-20 w-auto object-contain mb-4" />
        ) : (
          <Camera size={56} className={`${themeConfig.primary} mb-4`} />
        )}
        <h2 className={`text-3xl font-extrabold tracking-wide mt-1 text-center ${themeConfig.primary}`}>
          {appName}
        </h2>
        <div className="mt-3">
          <span className={`inline-flex items-center px-4 py-1.5 rounded-full text-xs font-semibold ${themeConfig.inputBg} border ${themeConfig.border} ${themeConfig.text.secondary} text-center`}>
            {appDescription}
          </span>
        </div>
      </div>

      {/* Login Card */}
      <div className={`w-full max-w-md p-8 rounded-2xl ${themeConfig.card}`}>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Username */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${themeConfig.text.secondary}`}>
              {t('imageService.auth.username')}
            </label>
            <div className="relative flex items-center">
              <div className={`absolute left-0 flex items-center justify-center w-10 h-full border-r ${themeConfig.border} text-gray-400`}>
                <User size={16} />
              </div>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className={`w-full pl-12 pr-3 py-2.5 rounded-lg text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} outline-none focus:border-cyan-400/50 transition-colors`}
                autoFocus
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${themeConfig.text.secondary}`}>
              {t('imageService.auth.password')}
            </label>
            <div className="relative flex items-center">
              <div className={`absolute left-0 flex items-center justify-center w-10 h-full border-r ${themeConfig.border} text-gray-400`}>
                <Lock size={16} />
              </div>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={`w-full pl-12 pr-10 py-2.5 rounded-lg text-sm border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} outline-none focus:border-cyan-400/50 transition-colors`}
              />
              <button 
                type="button" 
                onClick={() => setShowPw(!showPw)}
                className={`absolute right-3 text-gray-400 hover:${themeConfig.primary} transition-colors`}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && <p className="text-red-400 text-xs">{error}</p>}

          {/* Submit Button */}
          <button 
            type="submit" 
            disabled={loading}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold ${themeConfig.buttonGradient} transition-all transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50`}
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>{t('imageService.auth.login')}</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* No Account Registration Link */}
        <div className="text-center mt-5">
          <a href="#" className={`text-xs ${themeConfig.primary} ${themeConfig.primaryHover} transition-colors`}>
            {t('imageService.auth.noAccount')}
          </a>
        </div>
      </div>

      {/* Footer copyright */}
      <div className={`mt-8 text-center text-xs space-x-1.5 ${themeConfig.text.secondary}`}>
        <span>{appCopyright}</span>
        <span>|</span>
        <span>{t('ui.loginPage.version')}{' '}{appVersion}</span>
      </div>
    </div>
  )
}
