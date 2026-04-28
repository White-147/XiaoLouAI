import useCanvasStore from '@/stores/canvas'
import { createContext, useContext } from 'react'

export const CanvasContext = createContext<{
  canvasStore: typeof useCanvasStore
} | null>(null)

export const CanvasProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <CanvasContext.Provider value={{ canvasStore: useCanvasStore }}>
      {children}
    </CanvasContext.Provider>
  )
}

export const useCanvas = () => {
  const context = useContext(CanvasContext)
  if (!context) {
    throw new Error('useCanvas must be used within a CanvasProvider')
  }
  return context.canvasStore()
}
