import { Session } from '@/types/types'
import { PlusIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'

type SessionSelectorProps = {
  session: Session | null
  sessionList: Session[]
  onSelectSession: (sessionId: string) => void
  onClickNewChat: () => void
}

const SessionSelector: React.FC<SessionSelectorProps> = ({
  session,
  sessionList,
  onSelectSession,
  onClickNewChat,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex w-full items-center gap-2">
      <Select
        value={session?.id}
        onValueChange={(value) => {
          onSelectSession(value)
        }}
      >
        <SelectTrigger className="h-9 flex-1 min-w-0 rounded-xl border-slate-200/80 bg-white/[0.85] text-sm shadow-sm hover:bg-white dark:border-white/10 dark:bg-slate-900/[0.80]">
          <SelectValue placeholder="Theme" />
        </SelectTrigger>
        <SelectContent>
          {sessionList
            ?.filter((session) => session.id && session.id.trim() !== '') // Fix error of A ‹Select.Item /> must have a value prop that is not an empty string.
            ?.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {session.title}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      <Button
        variant={'outline'}
        onClick={onClickNewChat}
        className="h-9 shrink-0 gap-1 rounded-xl border-slate-200/80 bg-white/[0.85] px-3 text-sm shadow-sm hover:bg-white dark:border-white/10 dark:bg-slate-900/[0.80]"
      >
        <PlusIcon />
        <span className="text-sm">{t('chat:newChat')}</span>
      </Button>
    </div>
  )
}

export default SessionSelector
