import ErrorBoundary from '@/components/common/ErrorBoundary'
import { isXiaolouEmbedded } from '@/lib/xiaolou-embed'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

function RootRoute() {
  return (
    <>
      <Outlet />
      {!isXiaolouEmbedded() ? <TanStackRouterDevtools /> : null}
    </>
  )
}

export const Route = createRootRoute({
  component: RootRoute,
  errorComponent: ErrorBoundary,
})
