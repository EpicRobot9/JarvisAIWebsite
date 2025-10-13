import html2canvas from 'html2canvas'

export async function exportNodeToPng(el: HTMLElement, fileName = 'board.png'): Promise<Blob> {
  // Use html2canvas to render the element to a canvas, then toBlob for download
  const canvas = await html2canvas(el, {
    backgroundColor: '#0b1220', // match app background
    scale: Math.min(2, window.devicePixelRatio || 1.5),
    allowTaint: true,
    useCORS: true,
  })
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        // Trigger download
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        resolve(blob)
      } else {
        reject(new Error('Failed to generate PNG'))
      }
    }, 'image/png')
  })
}

export function defaultBoardFileName(title?: string) {
  const base = (title || 'board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return `${base || 'board'}-${ts}.png`
}
