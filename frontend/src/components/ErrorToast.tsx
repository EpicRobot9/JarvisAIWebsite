import { useEffect } from 'react'

export default function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [])
  return (
  <div className="fixed bottom-4 right-4 bg-red-600/90 text-white px-4 py-3 rounded-lg shadow-lg">
      {message}
    </div>
  )
}
