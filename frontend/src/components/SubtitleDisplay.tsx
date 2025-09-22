import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect } from 'react'

interface SubtitleDisplayProps {
  text: string
  isUser?: boolean
  className?: string
}

export default function SubtitleDisplay({ text, isUser = false, className = '' }: SubtitleDisplayProps) {
  const [displayText, setDisplayText] = useState('')
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (text) {
      setDisplayText(text)
      setIsVisible(true)
      
      // Auto-hide subtitle after 5 seconds if it's not a status message
      if (!text.includes('👂') && !text.includes('🎤') && !text.includes('🤔')) {
        const timeout = setTimeout(() => {
          setIsVisible(false)
        }, 5000)
        
        return () => clearTimeout(timeout)
      }
    } else {
      setIsVisible(false)
    }
  }, [text])

  const variants = {
    hidden: { 
      opacity: 0, 
      y: 20, 
      scale: 0.95 
    },
    visible: { 
      opacity: 1, 
      y: 0, 
      scale: 1,
      transition: {
        duration: 0.3,
        ease: 'easeOut'
      }
    },
    exit: { 
      opacity: 0, 
      y: -10, 
      scale: 0.95,
      transition: {
        duration: 0.2,
        ease: 'easeIn'
      }
    }
  }

  if (!text) return null

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          key={text}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className={`fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 ${className}`}
        >
          <div 
            className={`
              max-w-2xl mx-auto px-6 py-4 rounded-2xl backdrop-blur-md border shadow-2xl
              ${isUser 
                ? 'bg-blue-600/80 border-blue-400/30 text-blue-50' 
                : 'bg-slate-900/90 border-slate-700/50 text-slate-100'
              }
            `}
          >
            <div className="flex items-start gap-3">
              <div className={`
                flex-shrink-0 w-2 h-2 rounded-full mt-2
                ${isUser ? 'bg-blue-300' : 'bg-cyan-400'}
              `} />
              <div className="flex-1">
                <p className="text-sm font-medium leading-relaxed">
                  {displayText}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
