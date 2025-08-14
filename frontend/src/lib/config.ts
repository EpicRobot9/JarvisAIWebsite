export const PROD_WEBHOOK_URL = import.meta.env.VITE_WEBHOOK_URL || 'https://n8n.srv955268.hstgr.cloud/webhook/n8n'
export const TEST_WEBHOOK_URL = import.meta.env.VITE_WEBHOOK_TEST_URL || 'https://n8n.srv955268.hstgr.cloud/webhook-test/n8n'
// Back-compat alias; default to prod if not overridden
export const WEBHOOK_URL = PROD_WEBHOOK_URL
export const CALLBACK_URL = import.meta.env.VITE_CALLBACK_URL || '/api/jarvis/callback'
export const SOURCE_NAME = import.meta.env.VITE_SOURCE_NAME || 'jarvis-portal'
