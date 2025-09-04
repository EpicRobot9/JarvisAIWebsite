// Backend routes for Interstellar Manager
import { Router } from 'express'
import { z } from 'zod'
import { getSettingValue, setSettingValue, requireAuth, requireAdmin } from './auth.js'
import { PrismaClient } from '@prisma/client'
import fetch from 'node-fetch'
const prisma = new PrismaClient()

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
    
    // Add TypeOfInfo=Sheets to the GET URL for codespaces data
    const codespacesUrl = `${getUrl}?TypeOfInfo=Sheets`
    console.log('🎯 GET URL for codespaces:', codespacesUrl)
    
    const r = await fetch(codespacesUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    })
    if (!r.ok) {
      // Codespaces request failed, but we'll still try to get status
      if (r.status === 404 || r.status === 500 || r.status === 502 || r.status === 503) {
        codespacesNote = `External webhook service unavailable (${r.status}). Showing empty state.`
        data = { CurrentCodespaces: [], BackUpCodespaces: [] }
        console.log('🔧 Using fallback data due to webhook unavailable:', JSON.stringify(data, null, 2))
      } else {
        return res.status(502).json({ error: 'fetch_failed', status: r.status })
      }
    } else {
      data = await r.json()
      console.log('🎯 Raw data from n8n:', JSON.stringify(data, null, 2))
      
      // Ensure data has the required structure
      if (!data || typeof data !== 'object') {
        console.log('🔧 Invalid data structure, using fallback')
        data = { CurrentCodespaces: [], BackUpCodespaces: [] }
      } else {
        // Handle n8n's nested JSON response format
        if (data.json && typeof data.json === 'object') {
          console.log('🔧 Detected n8n nested json format, extracting data')
          data = data.json
        }
        
        // Ensure required arrays exist
        if (!Array.isArray(data.CurrentCodespaces)) {
          console.log('🔧 Missing or invalid CurrentCodespaces, initializing as empty array')
          data.CurrentCodespaces = []
        }
        if (!Array.isArray(data.BackUpCodespaces)) {
          console.log('🔧 Missing or invalid BackUpCodespaces, initializing as empty array')
          data.BackUpCodespaces = []
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
    
    // Now, get the status information
    console.log('🔍 Starting status request attempt...')
    let statusData = {}
    try {
      // Status is also a GET request with TypeOfInfo=Status query parameter
      const statusUrl = `${getUrl}?TypeOfInfo=Status`
      console.log('🎯 GET Status URL:', statusUrl)
      
      const statusResponse = await fetch(statusUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })
        console.log('Status response status:', statusResponse.status)
        if (statusResponse.ok) {
          const statusResult = await statusResponse.json()
          console.log('🔍 Raw Status result:', JSON.stringify(statusResult, null, 2))
          
          statusData = {}
          
          if (Array.isArray(statusResult) && statusResult.length > 0) {
            // Handle array format: [{"CurrentStatus": [{"codespace1": "status1"}, {"codespace2": "status2"}]}]
            if (statusResult[0].CurrentStatus && Array.isArray(statusResult[0].CurrentStatus)) {
              statusResult[0].CurrentStatus.forEach((item: any) => {
                if (typeof item === 'object' && item !== null) {
                  Object.assign(statusData, item)
                }
              })
              console.log('🔍 Merged status data from CurrentStatus array (wrapped in array):', JSON.stringify(statusData, null, 2))
            }
            // Handle old array format: [{"codespace1": "status1"}, {"codespace2": "status2"}]
            else {
              statusResult.forEach((item: any) => {
                if (typeof item === 'object' && item !== null && !item.CurrentStatus) {
                  Object.assign(statusData, item)
                }
              })
              console.log('🔍 Merged status data from direct array:', JSON.stringify(statusData, null, 2))
            }
          } else if (statusResult && typeof statusResult === 'object') {
            // Handle direct object with CurrentStatus: {"CurrentStatus": [{"codespace1": "status1"}, {"codespace2": "status2"}]}
            if ((statusResult as any).CurrentStatus && Array.isArray((statusResult as any).CurrentStatus)) {
              (statusResult as any).CurrentStatus.forEach((item: any) => {
                if (typeof item === 'object' && item !== null) {
                  Object.assign(statusData, item)
                }
              })
              console.log('🔍 Merged status data from CurrentStatus array (direct object):', JSON.stringify(statusData, null, 2))
            }
            // Handle direct object format: {"codespace1": "status1", "codespace2": "status2"}
            else {
              statusData = statusResult
              console.log('🔍 Using status data (direct object):', JSON.stringify(statusData, null, 2))
            }
          }
        } else {
          console.log('Status response not ok:', await statusResponse.text().catch(() => 'Failed to read response'))
        }
    } catch (e) {
      // If status request fails, continue without status data
      console.log('Status request failed:', e)
    }
    
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
    if (!r.ok) return res.status(502).json({ error: 'forward_failed', status: r.status })
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
      if (!r.ok) return res.status(502).json({ error: 'forward_failed', status: r.status })
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

