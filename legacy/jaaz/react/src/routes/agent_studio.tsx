import AgentStudio from '@/components/agent_studio/AgentStudio'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/agent_studio')({
  component: RouteComponent,
})

function RouteComponent() {
  return <AgentStudio />
}
