import { useCallback } from 'react'
import { Button } from '../ui/button'
import { BookOpenIcon, BotIcon, PlusIcon, WrenchIcon } from 'lucide-react'

export default function AgentNode() {
  return (
    <div className="p-4 bg-accent rounded-md flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <BotIcon className="size-4" />
        <input
          type="text"
          placeholder="Enter Agent Name"
          className="border-none outline-none"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        The description of the agent
      </p>
      <p className="font-bold flex items-center gap-2">
        <BookOpenIcon className="size-4" />
        <span>Knowledge</span>
      </p>
      <Button
        variant="outline"
        className="w-full
      "
      >
        <PlusIcon className="size-4" />
        Add Knowledge
      </Button>
      <p className="font-bold flex items-center gap-2">
        <WrenchIcon className="size-4" />
        <span>Tools</span>
      </p>
      <Button variant="outline" className="w-full">
        <PlusIcon className="size-4" />
        Add Tool
      </Button>
      <p className="font-bold flex items-center gap-2">
        <WrenchIcon className="size-4" />
        <span>Handoffs</span>
      </p>
      <Button variant="outline" className="w-full">
        <PlusIcon className="size-4" />
        Add Handoff
      </Button>
    </div>
  )
}
