import { eventBus } from '@/lib/event'

import { TEvents } from '@/lib/event'
import { useEffect } from 'react'

import Spinner from '@/components/ui/Spinner'
import { useState } from 'react'

export default function ToolcallProgressUpdate({
  sessionId,
}: {
  sessionId: string
}) {
  const [progress, setProgress] = useState('')

  useEffect(() => {
    const handleToolCallProgress = (
      data: TEvents['Socket::Session::ToolCallProgress']
    ) => {
      if (data.session_id === sessionId) {
        setProgress(data.update)
      }
    }

    eventBus.on('Socket::Session::ToolCallProgress', handleToolCallProgress)
    return () => {
      eventBus.off('Socket::Session::ToolCallProgress', handleToolCallProgress)
    }
  }, [sessionId])
  if (!progress) return null
  return (
    <div className="flex items-center gap-2 rounded-full border border-violet-200 bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-sm dark:border-violet-400/20 dark:bg-slate-900 dark:text-slate-200">
      <Spinner size={4} />
      {progress}
    </div>
  )
}
