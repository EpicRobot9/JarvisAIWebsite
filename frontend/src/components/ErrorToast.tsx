import { useEffect } from 'react'

export default function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="fixed bottom-4 right-4 max-w-sm">
      <div className="bg-red-600/90 text-white px-4 py-3 rounded-lg shadow-lg border border-white/10 animate-[toast-in_300ms_ease-out]">
        {message}
      </div>
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>
    </div>
  )
}
