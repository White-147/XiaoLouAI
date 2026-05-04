import MaterialManager from '@/components/material/MaterialManager'
import TopMenu from '@/components/TopMenu'
import { ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { isXiaolouEmbedded } from '@/lib/xiaolou-embed'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/assets')({
  component: Home,
})

function Home() {
  const xiaolouEmbedded = isXiaolouEmbedded()

  return (
    <div className="flex flex-col w-full h-full min-h-screen">
      {!xiaolouEmbedded && <TopMenu />}
      <ResizablePanelGroup
        direction="horizontal"
        className="w-full h-full min-h-0"
        autoSaveId="jaaz-chat-panel"
      >
        <ResizablePanel className="relative" defaultSize={100}>
          <MaterialManager />
        </ResizablePanel>

        {/* <ResizableHandle /> */}

        {/* <ResizablePanel defaultSize={25} minSize={25}>
            <div className="flex-1 flex-grow bg-accent/50 w-full">
              <ChatInterface
                canvasId={canvasId}
                sessionList={sessionList}
                setSessionList={setSessionList}
                sessionId={sessionId}
              />
            </div>
          </ResizablePanel> */}
      </ResizablePanelGroup>
    </div>
  )
}
