import { ToolType as ExcalidrawToolType } from '@excalidraw/excalidraw/types'
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hand,
  Image,
  Link,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  Type,
} from 'lucide-react'

export type ToolType = Extract<
  ExcalidrawToolType,
  | 'hand'
  | 'selection'
  | 'rectangle'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'eraser'
  | 'text'
  | 'image'
  | 'embeddable'
  | 'lock'
>

const icons: Record<ToolType, React.ComponentType<{ className?: string }>> = {
  hand: Hand,
  selection: MousePointer2,
  rectangle: Square,
  ellipse: Circle,
  arrow: ArrowUpRight,
  line: Minus,
  freedraw: Pencil,
  eraser: Eraser,
  text: Type,
  image: Image,
  embeddable: Link,
}

export const toolShortcuts: Record<ToolType, string> = {
  hand: 'H',
  selection: 'V',
  rectangle: 'R',
  ellipse: 'O',
  arrow: 'A',
  line: 'L',
  freedraw: 'P',
  eraser: 'E',
  text: 'T',
  image: '9',
  embeddable: '',
}

export default icons
