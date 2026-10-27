import React, { createContext, useContext, useState, useCallback } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: number
  type: ToastType
  message: string
}

interface ToastContextType {
  success: (msg: string) => void
  error: (msg: string) => void
  warning: (msg: string) => void
  info: (msg: string) => void
}

const ToastContext = createContext<ToastContextType>({
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
})

const TYPE_STYLES: Record<ToastType, string> = {
  success: 'bg-green-600/90 text-white',
  error: 'bg-red-600/90 text-white',
  warning: 'bg-yellow-600/90 text-white',
  info: 'bg-blue-600/90 text-white',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])

  const ctx: ToastContextType = {
    success: useCallback((m: string) => addToast('success', m), [addToast]),
    error: useCallback((m: string) => addToast('error', m), [addToast]),
    warning: useCallback((m: string) => addToast('warning', m), [addToast]),
    info: useCallback((m: string) => addToast('info', m), [addToast]),
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded-lg text-sm font-medium shadow-lg animate-in slide-in-from-right-2 ${TYPE_STYLES[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
