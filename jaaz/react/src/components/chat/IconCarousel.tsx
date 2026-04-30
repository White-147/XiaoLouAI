import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'motion/react'
import React, { useEffect, useState } from 'react'

type IconCarouselProps = {
  icons: React.ReactNode[]
  className?: string
  iconClassName?: string
  time?: number
}

const IconCarousel: React.FC<IconCarouselProps> = ({
  icons,
  className,
  time = 2000,
  iconClassName,
}) => {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % icons.length)
    }, time)
    return () => clearInterval(timer)
  }, [icons.length, time])

  return (
    <div
      className={cn('flex items-center justify-start gap-2', className)}
      style={{ minHeight: 40 }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          style={{ display: 'flex', alignItems: 'center' }}
          className={iconClassName}
        >
          {icons[index]}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export default IconCarousel
