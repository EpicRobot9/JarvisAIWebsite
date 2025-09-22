export const PROD_WEBHOOK_URL = import.meta.env.VITE_WEBHOOK_URL || 'https://n8n.srv955268.hstgr.cloud/webhook/n8n'
export const TEST_WEBHOOK_URL = import.meta.env.VITE_WEBHOOK_TEST_URL || 'https://n8n.srv955268.hstgr.cloud/webhook-test/n8n'
// Back-compat alias; default to prod if not overridden
export const WEBHOOK_URL = PROD_WEBHOOK_URL
export const CALLBACK_URL = import.meta.env.VITE_CALLBACK_URL || '/api/jarvis/callback'
export const SOURCE_NAME = import.meta.env.VITE_SOURCE_NAME || 'jarvis-portal'

// Chat persistence: previously used to reset messages after inactivity. Auto-clear is disabled.
// Kept for backward compatibility with any code that reads the constant, but no code should clear based on it.
export const CHAT_INACTIVITY_RESET_MS = Number(
	(import.meta.env.VITE_CHAT_INACTIVITY_RESET_MS as any) ?? 86_400_000
)
