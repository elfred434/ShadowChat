import axios from 'axios'

const unsafeMethods = new Set(['post', 'put', 'patch', 'delete'])

export const api = axios.create({
  // En développement, Vite transmet /api au backend ; en production, définir
  // VITE_API_URL (par exemple https://api.exemple.com/api/).
  baseURL: import.meta.env.VITE_API_URL || '/api/',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

function csrfToken(): string {
  const cookie = document.cookie.split('; ').find((value) => value.startsWith('csrftoken='))
  return cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : ''
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.error === 'string') {
    return error.response.data.error
  }
  return fallback
}

let csrfRequest: Promise<void> | null = null
async function ensureCsrfToken(): Promise<void> {
  if (csrfToken()) return
  csrfRequest ??= api.get('auth/csrf/').then(() => undefined).finally(() => { csrfRequest = null })
  await csrfRequest
}

api.interceptors.request.use(async (config) => {
  if (unsafeMethods.has((config.method || 'get').toLowerCase()) && !config.url?.includes('auth/csrf/')) {
    await ensureCsrfToken()
    const token = csrfToken()
    if (token) config.headers.set('X-CSRFToken', token)
  }
  return config
})
