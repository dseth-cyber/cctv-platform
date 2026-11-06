import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { AuthProvider } from '@/contexts/AuthContext'
import App from '@/App'
import { PageErrorBoundary } from '@/components/PageErrorBoundary'
import '@/i18n'
import '@/App.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // Retrying a 4xx (bad request, forbidden, not found, ...) just repeats the
      // same failure and — for 403s — doubles up the "forbidden" toast for no
      // benefit, since permissions won't change between the two attempts.
      retry: (failureCount, error: any) => {
        const status = error?.response?.status
        if (status >= 400 && status < 500) return false
        return failureCount < 1
      },
      staleTime: 1000 * 30,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <PageErrorBoundary>
                <App />
              </PageErrorBoundary>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
