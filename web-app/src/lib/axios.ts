import axios from 'axios'

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Skip the global "forbidden" toast for this request's 403s (e.g. optional enrichment data). */
    silent403?: boolean
  }
}

const api = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
})

let _toastForbidden: ((msg: string) => void) | null = null
export function setForbiddenHandler(fn: (msg: string) => void) { _toastForbidden = fn }

let isRefreshing = false
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = []

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)))
  failedQueue = []
}

function isLoginPage() {
  return window.location.pathname === '/login'
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 403) {
      const msg = error.response?.data?.message || 'Permission denied'
      // Some pages fetch optional enrichment data (dropdown options, related-module
      // lookups) the current role may not have rights to; those already degrade
      // gracefully to empty results and shouldn't surface a scary "forbidden" toast.
      if (_toastForbidden && !error.config?.silent403) _toastForbidden(msg)
      error._handled = true
      return Promise.reject(error)
    }

    const originalRequest = error.config
    if (error.response?.status !== 401 || originalRequest._retry) return Promise.reject(error)
    if (originalRequest.url?.includes('/auth/')) return Promise.reject(error)

    const refreshToken = localStorage.getItem('refreshToken')
    if (!refreshToken) {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`
        return api(originalRequest)
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      const { data } = await axios.post('/image-service/api/v1/auth/refresh', { refreshToken })
      localStorage.setItem('accessToken', data.accessToken)
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken)
      processQueue(null, data.accessToken)
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`
      return api(originalRequest)
    } catch (refreshError) {
      processQueue(refreshError, null)
      localStorage.clear()
      window.location.href = '/login'
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)

export default api
