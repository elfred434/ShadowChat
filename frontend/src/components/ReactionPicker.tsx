import { useEffect, useRef } from 'react'

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '👀']

export function ReactionPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Choisir une réaction"
      className="absolute top-7 left-0 z-30 flex gap-0.5 rounded-full border border-gray-200 bg-white p-1 shadow-lg"
    >
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="menuitem"
          onClick={() => onPick(emoji)}
          className="p-1 rounded-full text-lg leading-none hover:bg-gray-100 transition-transform hover:scale-125"
          aria-label={`Réagir avec ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
