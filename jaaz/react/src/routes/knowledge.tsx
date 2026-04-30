import Knowledge from '@/components/knowledge/Knowledge'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/knowledge')({
  component: RouteComponent,
})

function RouteComponent() {
  return <Knowledge />
}
