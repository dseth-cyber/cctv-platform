import { createContext, useContext, useState, useCallback, useEffect, type ReactNode, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/axios'

export interface User {
  id: string
  username: string
  email: string
  role: string
  permissions?: string[]
  /** False when this person is limited to some cameras. Missing on sessions from before it existed. */
  allCameras?: boolean
  hiddenMenuItems?: string[]
  uiPreferences?: Record<string, any>
  lastLogin: string | null
}

interface AuthContextType {
  user: User | null
  accessToken: string | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  updateHiddenMenuItems: (hiddenMenuItems: string[]) => Promise<void>
  updateUiPreferences: (patch: Record<string, any>) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

function storeTokens(access: string, refresh: string) {
  localStorage.setItem('accessToken', access)
  localStorage.setItem('refreshToken', refresh)
}

function clearTokens() {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem('user') ?? 'null') } catch { return null }
  })
  const [accessToken, setAccessToken] = useState<string | null>(() => localStorage.getItem('accessToken'))

  // Rights change while someone is signed in (an admin edits a role or a person): read them again when the page
  // opens and whenever the tab comes back, at most once a minute, instead of only at sign-in.
  const lastRefresh = useRef(0)
  const refreshMe = useCallback(async () => {
    if (!localStorage.getItem('accessToken') || Date.now() - lastRefresh.current < 60_000) return
    lastRefresh.current = Date.now()
    try {
      const { data } = await api.get('/image-service/api/v1/auth/me')
      setUser(prev => {
        const next = { ...(prev ?? {}), ...data }
        localStorage.setItem('user', JSON.stringify(next))
        return next as User
      })
    } catch { /* signed out or offline: keep what is there */ }
  }, [])
  useEffect(() => {
    if (!accessToken) return
    void refreshMe()
    const onShow = () => { if (!document.hidden) void refreshMe() }
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [accessToken, refreshMe])

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post('/image-service/api/v1/auth/login', { username, password })
    storeTokens(data.accessToken, data.refreshToken)
    localStorage.setItem('user', JSON.stringify(data.user))
    setAccessToken(data.accessToken)
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/image-service/api/v1/auth/logout') } catch { /* ignore */ }
    clearTokens()
    setAccessToken(null)
    setUser(null)
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.post('/image-service/api/v1/auth/change-password', { currentPassword, newPassword })
  }, [])

  // Persisted server-side (per user, follows them across devices) so a role
  // like "technician" can trim their own sidebar down to just what they use,
  // without losing access — hidden items are still reachable by direct URL.
  const updateHiddenMenuItems = useCallback(async (hiddenMenuItems: string[]) => {
    await api.patch('/image-service/api/v1/auth/me/menu-preferences', { hiddenMenuItems })
    setUser(prev => {
      if (!prev) return prev
      const next = { ...prev, hiddenMenuItems }
      localStorage.setItem('user', JSON.stringify(next))
      return next
    })
  }, [])

  // Per-user UI preferences (table columns, filter panel state, …) persisted
  // server-side and shallow-merged by page id, so they follow the user across
  // devices. Optimistically update local state, then persist.
  const updateUiPreferences = useCallback(async (patch: Record<string, any>) => {
    setUser(prev => {
      if (!prev) return prev
      const next = { ...prev, uiPreferences: { ...(prev.uiPreferences ?? {}), ...patch } }
      localStorage.setItem('user', JSON.stringify(next))
      return next
    })
    try {
      await api.patch('/image-service/api/v1/auth/me/preferences', { patch })
    } catch { /* keep optimistic local value; will retry on next change */ }
  }, [])

  return (
    <AuthContext.Provider value={{ user, accessToken, isAuthenticated: !!user, login, logout, changePassword, updateHiddenMenuItems, updateUiPreferences }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
