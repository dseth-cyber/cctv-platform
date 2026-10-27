import React, { createContext, useContext, useState, useMemo } from 'react'

export interface ThemeConfig {
  name: string
  label: string
  background: string
  card: string
  cardBorder: string
  text: { primary: string; secondary: string }
  textSecondary: string
  navBar: string
  navBorder: string
  sidebar: string
  sidebarBorder: string
  primary: string
  primaryHover: string
  buttonGradient: string
  inputBg: string
  inputBorder: string
  border: string
  tableHeader: string
  tableRow: string
  tableDivide: string
  tableBorder: string
  blob1: string
  blob2: string
  blob3: string
  glowColor: string
  progressTrack: string
}

export const themes: Record<string, ThemeConfig> = {
  modern: {
    name: 'modern',
    label: 'Modern Glassmorphism',
    background: 'bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800',
    card: 'bg-indigo-950/30 backdrop-blur-2xl border border-white/20 shadow-xl',
    cardBorder: 'border-white/20',
    text: { primary: 'text-white', secondary: 'text-gray-200' },
    textSecondary: 'text-gray-200',
    navBar: 'backdrop-blur-xl bg-white/10 border-b border-white/20 shadow-lg',
    navBorder: 'border-white/20',
    sidebar: 'backdrop-blur-xl bg-white/10 border-r border-white/20',
    sidebarBorder: 'border-white/20',
    primary: 'text-cyan-300',
    primaryHover: 'hover:text-cyan-200',
    buttonGradient: 'bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 hover:from-cyan-400 hover:via-blue-400 hover:to-indigo-500 shadow-lg shadow-cyan-500/20',
    inputBg: 'bg-white/10 backdrop-blur-md',
    inputBorder: 'border-white/30',
    border: 'border-white/30',
    tableHeader: 'bg-white/10 backdrop-blur-md',
    tableRow: 'hover:bg-white/5',
    tableDivide: 'divide-white/5',
    tableBorder: 'border-white/5',
    blob1: 'bg-purple-500/30',
    blob2: 'bg-cyan-500/25',
    blob3: 'bg-blue-500/30',
    glowColor: 'from-cyan-400 to-purple-500',
    progressTrack: 'bg-white/5',
  },
  dark: {
    name: 'dark',
    label: 'Dark Theme',
    background: 'bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950',
    card: 'bg-gray-800/80 backdrop-blur-sm border border-gray-700',
    cardBorder: 'border-gray-700',
    text: { primary: 'text-gray-100', secondary: 'text-gray-400' },
    textSecondary: 'text-gray-400',
    navBar: 'bg-gray-900/95 backdrop-blur-sm border-b border-gray-800',
    navBorder: 'border-gray-800',
    sidebar: 'bg-gray-900/95 backdrop-blur-sm border-r border-gray-800',
    sidebarBorder: 'border-gray-800',
    primary: 'text-blue-400',
    primaryHover: 'hover:text-blue-300',
    buttonGradient: 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600',
    inputBg: 'bg-gray-800/50',
    inputBorder: 'border-gray-700',
    border: 'border-gray-700',
    tableHeader: 'bg-gray-800/50',
    tableRow: 'hover:bg-gray-800/30',
    tableDivide: 'divide-gray-800',
    tableBorder: 'border-gray-800',
    blob1: 'bg-blue-900/10',
    blob2: 'bg-gray-800/20',
    blob3: 'bg-blue-800/10',
    glowColor: 'from-blue-600 to-blue-800',
    progressTrack: 'bg-gray-800/50',
  },
  light: {
    name: 'light',
    label: 'Light Theme',
    background: 'bg-gradient-to-br from-gray-50 via-blue-50 to-gray-100',
    card: 'bg-white/90 backdrop-blur-sm border border-gray-200 shadow-lg',
    cardBorder: 'border-gray-200',
    text: { primary: 'text-gray-900', secondary: 'text-gray-600' },
    textSecondary: 'text-gray-600',
    navBar: 'bg-white/95 backdrop-blur-sm border-b border-gray-200 shadow-sm',
    navBorder: 'border-gray-200',
    sidebar: 'bg-white/95 backdrop-blur-sm border-r border-gray-200',
    sidebarBorder: 'border-gray-200',
    primary: 'text-blue-600',
    primaryHover: 'hover:text-blue-700',
    buttonGradient: 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500',
    inputBg: 'bg-white',
    inputBorder: 'border-gray-300',
    border: 'border-gray-300',
    tableHeader: 'bg-gray-50',
    tableRow: 'hover:bg-gray-50',
    tableDivide: 'divide-gray-200',
    tableBorder: 'border-gray-200',
    blob1: 'bg-blue-200/30',
    blob2: 'bg-indigo-200/30',
    blob3: 'bg-purple-200/20',
    glowColor: 'from-blue-400 to-indigo-500',
    progressTrack: 'bg-gray-100',
  },
}

interface ThemeProviderState {
  theme: string
  themeConfig: ThemeConfig
  setTheme: (t: string) => void
}

const ThemeContext = createContext<ThemeProviderState>({
  theme: 'modern',
  themeConfig: themes.modern,
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('image-service-theme') || 'modern'
  })

  const themeConfig = useMemo(() => themes[theme] || themes.modern, [theme])

  const value = {
    theme,
    themeConfig,
    setTheme: (t: string) => {
      localStorage.setItem('image-service-theme', t)
      
      const userJson = localStorage.getItem('user')
      if (userJson) {
        try {
          const user = JSON.parse(userJson)
          if (user && user.username) {
            localStorage.setItem(`image-service-theme:${user.username}`, t)
          }
        } catch { /* ignore */ }
      }
      
      setThemeState(t)
    },
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
