import { cn } from '@/lib/utils'
import { useTheme } from 'next-themes'
import React, { useEffect, useState } from 'react'

interface HotkeyProps {
  keys: string[]
  modifier?: boolean
  isBackgroundDark?: boolean
}

export const Hotkey: React.FC<HotkeyProps> = ({
  keys,
  modifier = false,
  isBackgroundDark = false,
}) => {
  const { theme } = useTheme()

  const isMac = window.navigator.userAgent.includes('Macintosh')
  const modifierText = isMac ? '⌘' : '⌃'
  const displayKeys = modifier ? [modifierText, ...keys] : keys

  const isDarkTheme = theme === 'dark'

  const bgGradient = isDarkTheme
    ? 'bg-gradient-to-bl from-transparent via-transparent to-background/20'
    : 'bg-gradient-to-bl from-transparent via-transparent to-white/20'

  return (
    <span
      className={cn(
        'inline-flex gap-[2px]',
        isBackgroundDark ? 'text-background' : 'text-foreground'
      )}
    >
      {displayKeys.map((key, index) => (
        <kbd
          key={index}
          suppressHydrationWarning
          className={cn(
            'inline-flex items-center justify-center rounded border border-border font-sans text-[10px] font-medium h-4 w-4',
            index === 0 ? 'ml-2' : 'ml-[1px]',
            bgGradient,
            'bg-[length:100%_130%] bg-[0_100%]'
          )}
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
