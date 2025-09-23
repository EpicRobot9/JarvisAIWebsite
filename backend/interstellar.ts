// Backend routes for Interstellar Manager
import { Router } from 'express'
import { z } from 'zod'
import { getSettingValue, setSettingValue, requireAuth, requireAdmin } from './auth.js'
import { PrismaClient } from '@prisma/client'
import fetch from 'node-fetch'
const prisma = new PrismaClient()

// Simple in-memory cache of last successful codespaces payload per environment
// Keyed by 'prod' | 'test'. Data is the already-enriched array response we send to the frontend.
const codespacesCache = new Map<string, { data: any[]; at: number }>()

const router = Router()

// Get Interstellar webhook URLs (public read, admin write)
router.get('/api/interstellar-urls', async (req, res) => {
  try {
    const getProd = await getSettingValue('INTERSTELLAR_GET_URL_PROD')
    const getTest = await getSettingValue('INTERSTELLAR_GET_URL_TEST')
    const postProd = await getSettingValue('INTERSTELLAR_POST_URL_PROD')
    const postTest = await getSettingValue('INTERSTELLAR_POST_URL_TEST')
    res.json({
      prod: { get: getProd || '', post: postProd || '' },
      test: { get: getTest || '', post: postTest || '' }
    })
  } catch {
    res.status(500).json({ error: 'read_failed' })
  }
})

router.get('/api/admin/interstellar-webhook-urls', requireAuth, requireAdmin, async (req, res) => {
  try {
    const prodPost = await getSettingValue('INTERSTELLAR_POST_URL_PROD')
    const testPost = await getSettingValue('INTERSTELLAR_POST_URL_TEST')
    const prodGet = await getSettingValue('INTERSTELLAR_GET_URL_PROD')
    const testGet = await getSettingValue('INTERSTELLAR_GET_URL_TEST')
    res.json({
      prodPost: prodPost || '',
      testPost: testPost || '',
      prodGet: prodGet || '',
      testGet: testGet || ''
    })
  } catch {
    res.status(500).json({ error: 'read_failed' })
  }
})

router.get('/api/admin/interstellar-urls', requireAuth, requireAdmin, async (req, res) => {
  try {
    const getProd = await getSettingValue('INTERSTELLAR_GET_URL_PROD')
    const getTest = await getSettingValue('INTERSTELLAR_GET_URL_TEST')
    const postProd = await getSettingValue('INTERSTELLAR_POST_URL_PROD')
    const postTest = await getSettingValue('INTERSTELLAR_POST_URL_TEST')
    res.json({
      prod: { get: getProd || '', post: postProd || '' },
      test: { get: getTest || '', post: postTest || '' }
    })
  } catch {
    res.status(500).json({ error: 'read_failed' })
  }
})

const WebhookUrlsSchema = z.object({
  prodPost: z.string().trim().url().or(z.literal('')),
  testPost: z.string().trim().url().or(z.literal('')),
  prodGet: z.string().trim().url().or(z.literal('')),
  testGet: z.string().trim().url().or(z.literal(''))
})

const UrlsSchema = z.object({
  prod: z.object({
    get: z.string().trim().url().or(z.literal('')),
    post: z.string().trim().url().or(z.literal(''))
  }).optional(),
  test: z.object({
    get: z.string().trim().url().or(z.literal('')),
    post: z.string().trim().url().or(z.literal(''))
  }).optional()
})

router.post('/api/admin/interstellar-webhook-urls', requireAuth, requireAdmin, async (req, res) => {
  const v = WebhookUrlsSchema.safeParse(req.body)
  if (!v.success) {
    return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  }

  try {
    await setSettingValue('INTERSTELLAR_POST_URL_PROD', v.data.prodPost)
    await setSettingValue('INTERSTELLAR_POST_URL_TEST', v.data.testPost)
    await setSettingValue('INTERSTELLAR_GET_URL_PROD', v.data.prodGet)
    await setSettingValue('INTERSTELLAR_GET_URL_TEST', v.data.testGet)
    const prodPost = await getSettingValue('INTERSTELLAR_POST_URL_PROD')
    const testPost = await getSettingValue('INTERSTELLAR_POST_URL_TEST')
    const prodGet = await getSettingValue('INTERSTELLAR_GET_URL_PROD')
    const testGet = await getSettingValue('INTERSTELLAR_GET_URL_TEST')
    res.json({
      prodPost: prodPost || '',
      testPost: testPost || '',
      prodGet: prodGet || '',
      testGet: testGet || ''
    })
  } catch (e) {
    res.status(500).json({ error: 'save_failed', detail: String(e) })
  }
})

router.post('/api/admin/interstellar-urls', requireAuth, requireAdmin, async (req, res) => {
  const v = UrlsSchema.safeParse(req.body)
  if (!v.success) {
    return res.status(400).json({ error: 'invalid_body', issues: v.error.flatten() })
  }

  try {
    if (v.data.prod) {
      await setSettingValue('INTERSTELLAR_GET_URL_PROD', v.data.prod.get)
      await setSettingValue('INTERSTELLAR_POST_URL_PROD', v.data.prod.post)
    }
    if (v.data.test) {
      await setSettingValue('INTERSTELLAR_GET_URL_TEST', v.data.test.get)
      await setSettingValue('INTERSTELLAR_POST_URL_TEST', v.data.test.post)
    }
    const getProd = await getSettingValue('INTERSTELLAR_GET_URL_PROD')
    const getTest = await getSettingValue('INTERSTELLAR_GET_URL_TEST')
    const postProd = await getSettingValue('INTERSTELLAR_POST_URL_PROD')
    const postTest = await getSettingValue('INTERSTELLAR_POST_URL_TEST')
    res.json({
      ok: true,
      prod: { get: getProd || '', post: postProd || '' },
      test: { get: getTest || '', post: postTest || '' }
    })
  } catch (e) {
    res.status(500).json({ error: 'save_failed', detail: String(e) })
  }
})

// Report a blocked codespace (creates a pending request)
router.post('/api/interstellar/report', requireAuth, async (req: any, res) => {
  try {
    const { fullName } = req.body || {}
    if (!fullName || typeof fullName !== 'string') return res.status(400).json({ error: 'missing_fullName' })
    const r = await (prisma as any).interstellarRequest.create({ data: { userId: req.user.id, fullName } })
    res.json({ ok: true, request: { id: r.id, status: r.status, fullName: r.fullName, createdAt: r.createdAt } })
  } catch (e) {
    res.status(500).json({ error: 'save_failed' })
  }
})

// Admin: list pending interstellar requests
router.get('/api/admin/interstellar/requests', requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const items = await (prisma as any).interstellarRequest.findMany({ where: { status: 'pending' }, include: { user: { select: { id: true, username: true } } }, orderBy: { createdAt: 'asc' } })
    res.json({ items })
  } catch (e) {
    res.status(500).json({ error: 'read_failed' })
  }
})

// Admin: decide on a request (approve/deny). Approve will forward the Blocked action to the POST webhook and mark approved.
router.post('/api/admin/interstellar/requests/decide', requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const { requestId, decision } = req.body || {}
    if (!requestId || (decision !== 'approved' && decision !== 'denied')) return res.status(400).json({ error: 'invalid_body' })
  const r = await (prisma as any).interstellarRequest.findUnique({ where: { id: requestId } })
    if (!r) return res.status(404).json({ error: 'not_found' })
    if (r.status !== 'pending') return res.status(400).json({ error: 'already_decided' })

    if (decision === 'approved') {
      // Forward Blocked action to configured POST URL (prod/test determined by query param or default to prod)
      const env = (req.query.env as string) || 'prod'
      const postUrlKey = env === 'test' ? 'INTERSTELLAR_POST_URL_TEST' : 'INTERSTELLAR_POST_URL_PROD'
      const postUrl = await getSettingValue(postUrlKey)
      if (!postUrl) return res.status(400).json({ error: 'post_url_not_configured' })
      // Call external POST webhook
      try {
        const payload = [{ TypeOfAction: 'Blocked', BlockedCodespaceFullName: r.fullName }]
        const rr = await fetch(postUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        })
        if (!rr.ok) {
          // mark denied if forwarding failed
          await (prisma as any).interstellarRequest.update({ where: { id: requestId }, data: { status: 'denied', decidedById: req.user.id, decidedAt: new Date() } })
          return res.status(502).json({ error: 'forward_failed', status: rr.status })
        }
      } catch (e) {
        await (prisma as any).interstellarRequest.update({ where: { id: requestId }, data: { status: 'denied', decidedById: req.user.id, decidedAt: new Date() } })
        return res.status(502).json({ error: 'forward_failed' })
      }
      await (prisma as any).interstellarRequest.update({ where: { id: requestId }, data: { status: 'approved', decidedById: req.user.id, decidedAt: new Date() } })
      return res.json({ ok: true })
    }

    // Deny
    await (prisma as any).interstellarRequest.update({ where: { id: requestId }, data: { status: 'denied', decidedById: req.user.id, decidedAt: new Date() } })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'server_error' })
  }
})

// Admin-only server-side exec for actions that must be restricted (e.g., NewBackUp)
router.post('/api/admin/interstellar/exec', requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const { action, env } = req.body || {}
    if (!action || typeof action !== 'string') return res.status(400).json({ error: 'missing_action' })
    const which = (env === 'test') ? 'INTERSTELLAR_POST_URL_TEST' : 'INTERSTELLAR_POST_URL_PROD'
    const postUrl = await getSettingValue(which)
    if (!postUrl) return res.status(400).json({ error: 'post_url_not_configured' })
    const payload = [{ TypeOfAction: action }]
    const r = await fetch(postUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!r.ok) return res.status(502).json({ error: 'forward_failed', status: r.status })
    const txt = await r.text().catch(()=>'')
    return res.json({ ok: true, body: txt })
  } catch (e) {
    res.status(500).json({ error: 'server_error' })
  }
})

// Proxy GET requests to retrieve codespaces data
router.get('/api/interstellar/get-codespaces', async (req: any, res) => {
  console.log('🚀 GET /api/interstellar/get-codespaces called with env:', req.query?.env)
  try {
    const { env } = req.query || {}
    const which = (env === 'test') ? 'INTERSTELLAR_GET_URL_TEST' : 'INTERSTELLAR_GET_URL_PROD'
    const getUrl = await getSettingValue(which)
    if (!getUrl) return res.status(400).json({ error: 'get_url_not_configured' })
    
    // First, get the codespaces data
    let data: any = null
    let codespacesNote: string | null = null
    
    // Add TypeOfInfo=Sheets to the GET URL for codespaces data (robustly handle existing query params)
    let codespacesUrl: string
    try {
      const u = new URL(getUrl)
      u.searchParams.set('TypeOfInfo', 'Sheets')
      codespacesUrl = u.toString()
    } catch {
      const sep = getUrl.includes('?') ? '&' : '?'
      codespacesUrl = `${getUrl}${sep}TypeOfInfo=Sheets`
    }
    console.log('🎯 GET URL for codespaces:', codespacesUrl)
    
  const r = await fetch(codespacesUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })
    if (!r.ok) {
      // Codespaces request failed, but we'll still try a compatibility fallback and/or return empty state
  const bodyTxt = await r.text().catch(()=>'')
      console.log('⚠️ Interstellar GET codespaces failed', { url: codespacesUrl, status: r.status, bodyPreview: bodyTxt?.slice?.(0, 500) })

      // Fallback: many n8n setups expect a POST with an ARRAY payload for Sheets to the GET URL
      try {
        console.log('🔁 Trying POST fallback for Sheets payload (array form) to GET URL')
        const r2 = await fetch(getUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify([{ TypeOfInfo: 'Sheets' }])
        })
        if (r2.ok) {
          data = await r2.json()
          console.log('✅ POST fallback (array) to GET URL succeeded, data:', JSON.stringify(data, null, 2))
        } else {
          const b2 = await r2.text().catch(()=>'' )
          console.log('⚠️ POST fallback (array) to GET URL failed', { url: getUrl, status: r2.status, bodyPreview: b2?.slice?.(0, 500) })
          // Secondary attempt: some flows expect an object payload
          try {
            console.log('🔁 Trying POST fallback for Sheets payload (object form) to GET URL')
            const r3 = await fetch(getUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ TypeOfInfo: 'Sheets' })
            })
            if (r3.ok) {
              data = await r3.json()
              console.log('✅ POST fallback (object) to GET URL succeeded, data:', JSON.stringify(data, null, 2))
            } else {
              const b3 = await r3.text().catch(()=>'' )
              console.log('⚠️ POST fallback (object) to GET URL failed', { url: getUrl, status: r3.status, bodyPreview: b3?.slice?.(0, 500) })

              // Tertiary attempt: try the configured POST webhook URL in case the flow is unified there
              try {
                const postUrlKey = (env === 'test') ? 'INTERSTELLAR_POST_URL_TEST' : 'INTERSTELLAR_POST_URL_PROD'
                const postUrl = await getSettingValue(postUrlKey)
                if (postUrl) {
                  console.log('🔁 Trying POST fallback to POST URL (array form)')
                  const r4 = await fetch(postUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify([{ TypeOfInfo: 'Sheets' }])
                  })
                  if (r4.ok) {
                    data = await r4.json()
                    console.log('✅ POST fallback to POST URL (array) succeeded, data:', JSON.stringify(data, null, 2))
                  } else {
                    const b4 = await r4.text().catch(()=>'' )
                    console.log('⚠️ POST fallback to POST URL (array) failed', { url: postUrl, status: r4.status, bodyPreview: b4?.slice?.(0, 500) })
                    console.log('🔁 Trying POST fallback to POST URL (object form)')
                    const r5 = await fetch(postUrl, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                      body: JSON.stringify({ TypeOfInfo: 'Sheets' })
                    })
                    if (r5.ok) {
                      data = await r5.json()
                      console.log('✅ POST fallback to POST URL (object) succeeded, data:', JSON.stringify(data, null, 2))
                    } else {
                      const b5 = await r5.text().catch(()=>'' )
                      console.log('⚠️ POST fallback to POST URL (object) failed', { url: postUrl, status: r5.status, bodyPreview: b5?.slice?.(0, 500) })
                      // All attempts exhausted
                      codespacesNote = `External webhook service unavailable (${r.status}). Showing empty state.`
                      data = { CurrentCodespaces: [], BackUpCodespaces: [] }
                    }
                  }
                } else {
                  codespacesNote = `External webhook service unavailable (${r.status}). Showing empty state.`
                  data = { CurrentCodespaces: [], BackUpCodespaces: [] }
                }
              } catch (e3) {
                console.log('⚠️ POST fallback to POST URL error', e3)
                codespacesNote = `External webhook service unavailable (${r.status}). Showing empty state.`
                data = { CurrentCodespaces: [], BackUpCodespaces: [] }
              }
            }
          } catch (e2) {
            console.log('⚠️ POST fallback (object) error', e2)
            codespacesNote = `External webhook service unavailable (${r.status}). Showing empty state.`
            data = { CurrentCodespaces: [], BackUpCodespaces: [] }
          }
        }
      } catch (e) {
        console.log('⚠️ POST fallback (array) error', e)
        codespacesNote = `External webhook service unavailable (${r.status}). Showing empty state.`
        data = { CurrentCodespaces: [], BackUpCodespaces: [] }
      }

      // If we still have an empty state and have a recent cache, return cached data
      if (Array.isArray((data as any)?.CurrentCodespaces) && Array.isArray((data as any)?.BackUpCodespaces)) {
        if ((data as any).CurrentCodespaces.length === 0 && (data as any).BackUpCodespaces.length === 0) {
          const cached = codespacesCache.get(env === 'test' ? 'test' : 'prod')
          const maxAgeMs = 10 * 60 * 1000 // 10 minutes
          if (cached && Date.now() - cached.at < maxAgeMs) {
            const ageMin = Math.round((Date.now() - cached.at) / 60000)
            console.log('💾 Serving cached codespaces data (age min):', ageMin)
            const cachedWithNote = cached.data.map(item => ({
              ...item,
              _note: `Using cached data (${ageMin} min old) due to upstream error.`
            }))
            return res.json(cachedWithNote)
          }
        }
      }
    } else {
      data = await r.json()
      console.log('🎯 Raw data from n8n:', JSON.stringify(data, null, 2))

      // Unwrap common n8n formats: array of items and/or nested { json: {...} }
      if (Array.isArray(data)) {
        const first = data[0]
        if (first && typeof first === 'object' && first.json && typeof first.json === 'object') {
          console.log('🔧 Detected n8n array-of-json format, extracting first item.json')
          data = first.json
        } else if (first && typeof first === 'object' && (first.CurrentCodespaces || first.BackUpCodespaces)) {
          console.log('🔧 Detected array with expected shape, using first element')
          data = first
        } else {
          console.log('🔧 Unexpected array format, using fallback')
          data = { CurrentCodespaces: [], BackUpCodespaces: [] }
        }
      }

      // Ensure data has the required structure
      if (!data || typeof data !== 'object') {
        console.log('🔧 Invalid data structure, using fallback')
        data = { CurrentCodespaces: [], BackUpCodespaces: [] }
      } else {
        // Handle n8n's nested JSON response format on object
        if ((data as any).json && typeof (data as any).json === 'object') {
          console.log('🔧 Detected n8n nested json format, extracting data')
          data = (data as any).json
        }

        // Ensure required arrays exist
        if (!Array.isArray((data as any).CurrentCodespaces)) {
          console.log('🔧 Missing or invalid CurrentCodespaces, initializing as empty array')
          ;(data as any).CurrentCodespaces = []
        }
        if (!Array.isArray((data as any).BackUpCodespaces)) {
          console.log('🔧 Missing or invalid BackUpCodespaces, initializing as empty array')
          ;(data as any).BackUpCodespaces = []
        }
      }
    }
    
    // Normalize the data structure and public URL fields
    if (data && typeof data === 'object') {
      if (Array.isArray(data.CurrentCodespaces)) {
        data.CurrentCodespaces = data.CurrentCodespaces.map((c: any) => ({
          ...c,
          public_url: c.public_url || c['Public URL'] || c['Public Url'] || c.publicUrl || c.PublicURL || c.url || c.URL || ''
        }))
      }
      if (Array.isArray(data.BackUpCodespaces)) {
        data.BackUpCodespaces = data.BackUpCodespaces.map((c: any) => ({
          ...c,
          public_url: c.public_url || c['Public URL'] || c['Public Url'] || c.publicUrl || c.PublicURL || c.url || c.URL || ''
        }))
      }
      console.log('🎯 Normalized data with public_url fields:', JSON.stringify(data, null, 2))
    }
    
  // Use Sheets info only for both prod and test; skip separate Status fetch
  // This avoids inconsistencies across environments and reduces external errors.
  let statusData = {}
    
    // Handle both array and direct object responses from n8n
    let responseData
    try {
      responseData = Array.isArray(data) ? data : [data]
      
      // Ensure the first item in the response has the required structure
      if (responseData.length === 0 || !responseData[0] || typeof responseData[0] !== 'object') {
        console.log('🔧 Empty or invalid response data, using fallback structure')
        responseData = [{ CurrentCodespaces: [], BackUpCodespaces: [] }]
      }
      
      // Verify each item has the required arrays
      responseData = responseData.map(item => ({
        CurrentCodespaces: Array.isArray(item.CurrentCodespaces) ? item.CurrentCodespaces : [],
        BackUpCodespaces: Array.isArray(item.BackUpCodespaces) ? item.BackUpCodespaces : [],
        ...item
      }))
      
    } catch (e) {
      console.log('🔧 Error processing response data, using fallback:', e)
      responseData = [{ CurrentCodespaces: [], BackUpCodespaces: [] }]
    }
    
    // Add status information to the response
    const enrichedData = responseData.map(item => ({
      ...item,
      _statusData: statusData,
      ...(codespacesNote && { _note: codespacesNote })
    }))
    
    console.log('🎯 Final enriched data being sent to frontend:', JSON.stringify(enrichedData, null, 2))

    // Save to cache for this environment
    try {
      codespacesCache.set(env === 'test' ? 'test' : 'prod', { data: enrichedData, at: Date.now() })
    } catch {}
    
    return res.json(enrichedData)
  } catch (e) {
    console.log('🔧 Network or processing error occurred:', e)
    // On network errors, provide fallback response instead of error
    if (e instanceof Error && (e.message.includes('ENOTFOUND') || e.message.includes('ECONNREFUSED') || e.message.includes('fetch failed'))) {
      console.log('🔧 Returning network error fallback')
      return res.json([{
        CurrentCodespaces: [],
        BackUpCodespaces: [],
        _statusData: {},
        _note: 'External webhook service unreachable. Showing empty state.'
      }])
    }
    // For any other errors, still provide a consistent response structure
    console.log('🔧 Returning general error fallback')
    return res.json([{
      CurrentCodespaces: [],
      BackUpCodespaces: [],
      _statusData: {},
      _note: 'Error loading codespace data. Showing empty state.'
    }])
  }
})

// Proxy POST requests for start/stop operations
router.post('/api/interstellar/control', async (req: any, res) => {
  try {
    const { action, env } = req.body || {}
    if (!action || typeof action !== 'string') return res.status(400).json({ error: 'missing_action' })
    const which = (env === 'test') ? 'INTERSTELLAR_POST_URL_TEST' : 'INTERSTELLAR_POST_URL_PROD'
    const postUrl = await getSettingValue(which)
    if (!postUrl) return res.status(400).json({ error: 'post_url_not_configured' })
    
    const payload = [{ TypeOfAction: action }]
    const r = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!r.ok) {
      const txt = await r.text().catch(()=>'')
      console.log('⚠️ Interstellar control forward_failed', { url: postUrl, status: r.status, bodyPreview: txt?.slice?.(0, 500) })
      return res.status(502).json({ error: 'forward_failed', status: r.status })
    }
    const txt = await r.text().catch(()=>'')
    return res.json({ ok: true, body: txt })
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e) })
  }
})

// Block a codespace - admins get instant block, users create pending request
router.post('/api/interstellar/block', requireAuth, async (req: any, res) => {
  try {
    const { fullName, env } = req.body || {}
    if (!fullName || typeof fullName !== 'string') return res.status(400).json({ error: 'missing_fullName' })
    
    // Check if user is admin
    if (req.user.role === 'admin') {
      // Admin: Execute block immediately
      const which = (env === 'test') ? 'INTERSTELLAR_POST_URL_TEST' : 'INTERSTELLAR_POST_URL_PROD'
      const postUrl = await getSettingValue(which)
      if (!postUrl) return res.status(400).json({ error: 'post_url_not_configured' })
      
      const payload = [{ TypeOfAction: 'Blocked', BlockedCodespaceFullName: fullName }]
      const r = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!r.ok) {
        const txt = await r.text().catch(()=>"")
        console.log('⚠️ Interstellar block forward_failed', { url: postUrl, status: r.status, bodyPreview: txt?.slice?.(0, 500) })
        return res.status(502).json({ error: 'forward_failed', status: r.status })
      }
      const txt = await r.text().catch(()=>'')
      return res.json({ ok: true, blocked: true, body: txt })
    } else {
      // Non-admin: Create pending request
      const r = await (prisma as any).interstellarRequest.create({ 
        data: { userId: req.user.id, fullName } 
      })
      res.json({ 
        ok: true, 
        pending: true, 
        request: { 
          id: r.id, 
          status: r.status, 
          fullName: r.fullName, 
          createdAt: r.createdAt 
        } 
      })
    }
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e) })
  }
})

export default router

