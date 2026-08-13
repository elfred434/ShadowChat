import { api } from './client'
import type { User } from './auth'

// ---------------------------------------------------------------------------
// Vérification d'adresse e-mail
// ---------------------------------------------------------------------------
export async function verifyEmail(token: string): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('auth/email/verify/', { token })
  return response.data
}

export async function resendVerificationEmail(): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('auth/email/resend/', {})
  return response.data
}

// ---------------------------------------------------------------------------
// Réinitialisation / changement de mot de passe
// ---------------------------------------------------------------------------
export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('auth/password/reset/request/', { email })
  return response.data
}

export async function confirmPasswordReset(
  token: string,
  password: string,
  passwordConfirm: string,
): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('auth/password/reset/confirm/', {
    token,
    password,
    password_confirm: passwordConfirm,
  })
  return response.data
}

export async function changePassword(
  oldPassword: string,
  newPassword: string,
  newPasswordConfirm: string,
): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('auth/password/change/', {
    old_password: oldPassword,
    new_password: newPassword,
    new_password_confirm: newPasswordConfirm,
  })
  return response.data
}

// ---------------------------------------------------------------------------
// Authentification à deux facteurs (TOTP)
// ---------------------------------------------------------------------------
export async function completeLogin2fa(token: string, code: string): Promise<{ message: string; user: User }> {
  const response = await api.post<{ message: string; user: User }>('auth/login/2fa/', { token, code })
  return response.data
}

export async function totpSetup(): Promise<{ secret: string; otpauth_url: string }> {
  const response = await api.post<{ secret: string; otpauth_url: string }>('auth/2fa/setup/', {})
  return response.data
}

export async function totpEnable(code: string): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('auth/2fa/enable/', { code })
  return response.data
}

export async function totpDisable(password: string): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('auth/2fa/disable/', { password })
  return response.data
}

// ---------------------------------------------------------------------------
// Sessions actives
// ---------------------------------------------------------------------------
export interface SessionInfo {
  session_key: string
  expire_date: string
  is_current: boolean
}

export async function getSessions(): Promise<SessionInfo[]> {
  const response = await api.get<{ sessions: SessionInfo[] }>('auth/sessions/')
  return response.data.sessions
}

export async function revokeSession(sessionKey: string): Promise<void> {
  await api.post('auth/sessions/revoke/', { session_key: sessionKey })
}

// ---------------------------------------------------------------------------
// Signalements (modération)
// ---------------------------------------------------------------------------
export async function reportUser(userId: number, reason: string): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('reports/', { kind: 'user', user_id: userId, reason })
  return response.data
}

export async function reportMessage(messageId: number, reason: string): Promise<{ message: string }> {
  const response = await api.post<{ message: string }>('reports/', { kind: 'message', message_id: messageId, reason })
  return response.data
}
