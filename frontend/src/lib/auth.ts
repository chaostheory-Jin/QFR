// Browser-only module — login() and logout() must only be called from client components
// Temporary hardcoded credentials — replace the body of login() with a fetch() call when backend is ready
const TEMP_USERNAME = 'admin'
const TEMP_PASSWORD = 'admin123'

export function checkCredentials(username: string, password: string): boolean {
  return username === TEMP_USERNAME && password === TEMP_PASSWORD
}

export function login(username: string, password: string): boolean {
  const ok = checkCredentials(username, password)
  if (ok) {
    document.cookie = 'qfr_auth=1; path=/; SameSite=Strict'
    sessionStorage.setItem('qfr_session', '1')
    sessionStorage.removeItem('qfr_openai_api_key')
  }
  return ok
}

export function logout(): void {
  document.cookie = 'qfr_auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict'
  sessionStorage.removeItem('qfr_session')
  sessionStorage.removeItem('qfr_openai_api_key')
  void fetch('/api/session-key', { method: 'DELETE' })
}
