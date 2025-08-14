export const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key)
      return v == null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
  },
  getString(key, fallback = '') {
    try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
  },
  remove(key) {
    try { localStorage.removeItem(key) } catch {}
  }
}
