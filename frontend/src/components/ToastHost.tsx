import React, { createContext, useCallback, useContext, useState } from 'react'

export interface Toast { id: string; message: string; type?: 'info' | 'success' | 'error'; ttl?: number }

interface ToastCtx {
  push: (t: Omit<Toast,'id'>) => void
}

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast,'id'>) => {
    const id = crypto.randomUUID()
    const toast: Toast = { id, ttl: 4000, ...t }
    setToasts(prev => [...prev, toast])
    setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== id))
    }, toast.ttl)
  }, [])
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[1000] space-y-2">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-2 rounded-md shadow text-sm border backdrop-blur bg-slate-900/80 ${t.type==='error' ? 'border-red-600 text-red-200' : t.type==='success' ? 'border-emerald-600 text-emerald-200' : 'border-slate-600 text-slate-200'}`}>{t.message}</div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx.push
}
