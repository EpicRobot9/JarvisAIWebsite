const CACHE_NAME = 'jarvis-shell-v1'
const APP_SHELL = [
  '/',
  '/index.html',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    try { await cache.addAll(APP_SHELL) } catch {}
    self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))))
    self.clients.claim()
  })())
})

// Network-first for HTML, cache-first for other static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith((async () => {
      try {
        const net = await fetch(event.request)
        const cache = await caches.open(CACHE_NAME)
        cache.put('/index.html', net.clone())
        return net
      } catch {
        const cache = await caches.open(CACHE_NAME)
        return (await cache.match('/index.html')) || Response.error()
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(event.request)
    if (cached) return cached
    try {
      const net = await fetch(event.request)
      cache.put(event.request, net.clone())
      return net
    } catch {
      return cached || Response.error()
    }
  })())
})
